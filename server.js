// Library
const express = require('express')
const app = express()
app.use(express.json())
app.use(express.urlencoded({extended:true}))

const session = require('express-session')
const passport = require('passport')
const LocalStrategy = require('passport-local')
const MongoStore = require('connect-mongo')

require('dotenv').config()

app.use(passport.initialize())
app.use(session({
    secret: '암호화에 쓸 비번',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 60 * 60 * 1000 },
    store: MongoStore.create({
        mongoUrl: process.env.MongoDB_URL,
        dbName: 'forum',
    })
}));

app.use(passport.session());

const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const multer = require("multer");
const multerS3 = require("multer-s3");
const sharp = require('sharp');

// S3 클라이언트 설정
const s3Client = new S3Client({
    region: "ap-northeast-2", // AWS 리전 설정
    credentials: {
        accessKeyId: process.env.S3_KEY,
        secretAccessKey: process.env.S3_SECRET,
    },
});

// Multer 및 Multer-S3 설정
const upload = multer({
    storage: multerS3({
        s3: s3Client,
        bucket: "soo1eforum", // S3 버킷 이름
        acl: "public-read", // 업로드된 객체에 대한 ACL 설정 (public-read는 누구나 읽을 수 있도록 설정)
        key: function (req, file, cb) {
            cb(null, Date.now().toString()); // 업로드시 파일명 변경가능
        },
    }),
    fileFilter: function (req, file, cb) {
        // 이미지 파일만 허용
        if (file.mimetype.startsWith("image/")) {
            cb(null, true);
        } else {
            cb(new Error("이미지 파일만 업로드 가능합니다."), false);
        }
    },
});

// 이미지 업로드 라우트
// 이미지 업로드 및 썸네일 생성 및 S3 업로드 라우트
app.post('/upload', upload.single('img1'), async (req, res) => {
    try {
        // 업로드된 이미지를 Sharp 모듈을 사용하여 리사이징하고 배경 채우기
        const maxWidth = 200;
        const maxHeight = 200;

        const resizedImageBuffer = await sharp(req.file.buffer)
            .resize({
                width: maxWidth,
                height: maxHeight,
                fit: sharp.fit.cover,
                background: { r: 0, g: 0, b: 0, alpha: 1 }
            })
            .toBuffer();

        // 리사이징된 썸네일을 S3에 업로드
        const thumbnailUploadParams = {
            Bucket: 'soo1eforum',
            Key: `thumbnails/${Date.now().toString()}.jpg`,
            Body: resizedImageBuffer,
            ACL: 'public-read',
            ContentType: 'image/jpeg'
        };

        await s3Client.send(new PutObjectCommand(thumbnailUploadParams));

        // 업로드 완료 후 처리 로직
        const thumbnailUrl = `https://soo1eforum.s3.ap-northeast-2.amazonaws.com/thumbnails/${Date.now().toString()}.jpg`;
        console.log(req.file);

        // 업로드된 이미지의 썸네일 URL을 포스트 정보에 추가하고 DB에 저장
        const post = {
            title: req.body.title,
            content: req.body.content,
            thumbnailUrl: thumbnailUrl // 이미지의 썸네일 URL을 포스트 정보에 추가
        };

        // DB에 저장
        await db.collection('post').insertOne(post);

        console.log("이미지 업로드 및 썸네일 생성 완료:", thumbnailUrl);

        // list.ejs 템플릿에 데이터를 전달하여 렌더링합니다.
        res.render('list', { thumbnailUrl: thumbnailUrl });

    } catch (error) {
        console.error("이미지 업로드 오류:", error);
        // 오류 발생 시 500 상태 코드와 오류 메시지를 응답으로 보냅니다.
        res.status(500).json({ error: "이미지 업로드 중 오류 발생" });
    }
});



passport.use(new LocalStrategy(async (입력한아이디, 입력한비번, cb) => {
    let result = await db.collection('user').findOne({ username : 입력한아이디})
    if (!result) {
        return cb(null, false, { message: '올바른 ID를 입력하세요' })
    }

    if (await bcrypt.compare(입력한비번, result.password)) {
        return cb(null, result)
    } else {
        return cb(null, false, { message: '비밀번호가 일치하지 않습니다' });
    }
}))

passport.serializeUser((user, done) => {
    process.nextTick(() => {
        done(null, { id: user._id, username: user.username })
    })
})

passport.deserializeUser(async (user, done) => {
    let result = await db.collection('user').findOne({_id : new ObjectId(user.id) })
    delete result.password
    process.nextTick(() => {
        return done(null, result)
    })
})


app.use((req, res, next) => {
    res.locals.isAuthenticated = req.isAuthenticated();
    res.locals.user = req.user; // 현재 사용자 정보를 locals에 저장
    next();
});

// ejs 연결
app.set('view engine', 'ejs')

// public 폴더 연결
app.use(express.static(__dirname + '/public'));

// db 연동
const { MongoClient, ObjectId } = require('mongodb')

let db
const url = process.env.MongoDB_URL
new MongoClient(url).connect().then((client)=>{
    console.log('DB 연결 성공')
    db = client.db('forum')
}).catch((err)=>{
    console.log(err)
})

const bcrypt = require('bcrypt')

// 실제 서버
app.listen(process.env.PORT, () => {
    console.log('http://localhost:8080 에서 서버 실행중')
})

// 메인 페이지
app.get('/', async (req, res) => {
    let result = await db.collection('post').find().toArray();
    // db.collection('post').find().toArray() 실행 될 때까지 기다려주세요!
    res.render('main.ejs', { result : result })
})

// 리스트 페이지
app.get('/list', async (req, res) => {
    let result = await db.collection('post').find().toArray();
    // db.collection('post').find().toArray() 실행 될 때까지 기다려주세요!

    // total 페이지 수 계산 (예: 한 페이지에 5개의 글을 표시한다고 가정)
    const postsPerPage = 5;
    const totalPages = Math.ceil(result.length / postsPerPage);

    res.render('list.ejs', { result: result, totalPages: totalPages} );
});

// 글 작성 페이지
app.get('/write', (req, res) => {
    if (req.isAuthenticated()) {
        // 로그인된 사용자인 경우 글 작성 페이지 렌더링
        res.render('write.ejs');
    } else {
        // 로그인되지 않은 사용자인 경우 로그인 페이지로 리디렉션
        res.redirect('/login');
    }
});

app.post('/add', upload.single('img1'), async (req, res) => {
    if (req.isAuthenticated()) {
        try {
            if (req.body.title === '' || !req.body.content) {
                // 클라이언트에게 메시지를 응답으로 보내기
                return res.status(400).send('제목과 내용을 입력해주세요.');
            }

            let postData = {
                title: req.body.title,
                content: req.body.content,
                date: Date.now(),
                user : req.user._id,
                username : req.user.username,
            };

            // 이미지가 있는 경우에만 img 속성 추가
            if (req.file) {
                postData.img = req.file.location;
            }

            await db.collection('post').insertOne(postData);
            // 리다이렉트 대신 응답으로 성공 상태 전송
            res.redirect('/list');
        } catch (err) {
            console.log(err);
            // 에러가 발생한 경우 에러 응답 보내기
            res.status(500).send('서버 에러 발생');
        }
    } else {
        // 로그인되지 않은 사용자인 경우 로그인 페이지로 리디렉션
        res.redirect('/login');
    }
});

// 상세 페이지 /detail/글번호로 만들기
app.get('/detail/:id', async (req, res) => {
    try {
        let result = await db.collection('post').findOne({ _id : new ObjectId(req.params.id) })
        let result2 = await db.collection('comment').find({ parentID : new ObjectId(req.params.id) }).toArray() // 댓글 데이터 가져오기

        if (result == null) {
            res.status(400).send('해당되는 글이 없습니다.')
        } else {
            res.render('detail.ejs', { result: result, result2: result2 }); // 댓글 데이터를 템플릿에 전달
        }
    } catch (e) {
        res.send('에러를 입력하지 마세요.')
    }
});

// 글 수정 페이지
app.get('/edit/:id', async (req, res) => {
    let result = await db.collection('post').findOne({ _id : new ObjectId(req.params.id) })
    res.render('edit.ejs', { result : result })
})

app.post('/edit/:id', async (req, res) => {
    const postId = req.params.id;
    const updatedData = {
        title: req.body.title,
        content: req.body.content
    };

    try {
        await db.collection('post').updateOne({ _id: new ObjectId(postId) , username : req.user.username, user : req.user._id }), { $set: updatedData };
        res.redirect('/list');
    } catch (error) {
        console.error(error);
        res.status(500).send('서버 오류가 발생했습니다.');
    }
});

// 글 삭제
app.get('/delete/:id', async (req, res) => {
    const postId = req.params.id;

    try {
        await db.collection('post').deleteOne({ _id: new ObjectId(postId), username : req.user.username, user : req.user._id });
        res.redirect('/list');
    } catch (error) {
        console.error(error);
        res.status(500).send('서버 오류가 발생했습니다.');
    }
});

// 페이지네이션
// 서버 측 Express.js 라우트에서 페이지 별 글 목록 가져오기
app.get('/list/:page', async (req, res) => {
    const itemsPerPage = 5; // 페이지당 표시할 글 수
    const currentPage = parseInt(req.params.page) || 1; // 클라이언트가 요청한 페이지 번호

    try {
        const totalItems = await db.collection('post').countDocuments();
        const totalPages = Math.ceil(totalItems / itemsPerPage);

        const result = await db.collection('post').find()
            .skip((currentPage - 1) * itemsPerPage)
            .limit(itemsPerPage)
            .toArray();

        res.render('list.ejs', {
            result: result,
            totalPages: totalPages,
            currentPage: currentPage
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('서버 오류가 발생했습니다.');
    }
});




// 회원 기능 구현
// 세션 방식
// 1. 가입 기능
// 2. 로그인 기능
// 3. 로그인 완료 시 세션 만들기
// 4. 로그인 완료 시 유저에게 입장권 보내줌
// 5. 로그인 여부 확인하고 싶으면 입장권을 까봄

app.get('/login', async (req, res) => {
    res.render('login.ejs');
})

app.post('/login', async (req, res, next) => {
    passport.authenticate('local', (error, user, info) => {
        if (error) return res.status(500).json(error);
        if (!user) return res.status(500).json(info.message);
        // 입력된 비밀번호를 해시로 변환하여 비교
        bcrypt.compare(req.body.password, user.password, (err, result) => {
            if (err) return res.status(500).json(err);
            if (result) {
                req.logIn(user, (err) => {
                    if (err) return next(err);
                    res.redirect('/');
                });
            } else {
                res.status(500).json({ message: '비밀번호가 일치하지 않습니다' });
            }
        });
    })(req, res, next);
});

app.get('/register', async (req, res) => {
    res.render('register.ejs');
})

app.post('/register', async (req, res) => {

    let hash = await bcrypt.hash(req.body.password, 10)

    const username = req.body.username;
    const password = req.body.password;

    // 예외 처리: username이 빈칸일 때
    if (!username || username.trim() === '') {
        return res.status(400).send('사용자 이름을 입력하세요.');
    }

    // 예외 처리: username이 이미 DB에 있을 때
    const existingUser = await db.collection('user').findOne({ username: username });
    if (existingUser) {
        return res.status(400).send('이미 존재하는 사용자 이름입니다.');
    }

    // 예외 처리: password가 짧을 때
    if (!password || password.length < 6) {
        return res.status(400).send('비밀번호는 최소 6자 이상이어야 합니다.');
    }

    // 새로운 사용자 등록
    await db.collection('user').insertOne({ username: req.body.username , password: hash });
    res.redirect('/');
});

app.get('/logout', (req, res) => {
    req.logout((err) => {
        if (err) {
            return res.status(500).send('로그아웃 중 오류가 발생했습니다.');
        }
        res.redirect('/');
    });
});


// 검색 기능
app.get('/search', async (req, res)=>{
    let result = await db.collection('post').find({title : {$regex : req.query.val} }).toArray()
    res.render('search.ejs', { result : result })
})


// 댓글 기능
app.post('/comment', async (req, res) => {
    let result = await db.collection('comment').insertOne({
        content : req.body.content,
        writerID : new ObjectId(req.user._id),
        writer : req.user.username,
        parentID : new ObjectId(req.body.parentId),
    })

    res.redirect('back');
})

// 댓글 수정 페이지 렌더링
app.get('/comment/:id/edit', async (req, res) => {
    try {
        const commentId = req.params.id;
        const comment = await db.collection('comment').findOne({ _id: new ObjectId(commentId) });

        // 로그인한 사용자와 댓글 작성자의 ID를 비교하여 동일한 경우에만 수정 페이지로 이동
        if (req.isAuthenticated() && comment && req.user._id.toString() === comment.writerID.toString()) {
            res.json(comment); // 수정 폼에 필요한 데이터를 JSON 형식으로 응답
        } else {
            res.status(401).send('권한이 없습니다.');
        }
    } catch (error) {
        console.error(error);
        res.status(500).send('서버 오류가 발생했습니다.');
    }
});

// 댓글 수정 처리
app.put('/comment/:id/edit', async (req, res) => {
    const commentId = req.params.id;
    const updatedContent = req.body.content; // 수정된 댓글 내용

    try {
        // 댓글 업데이트 로직을 구현해주세요
        // ...
        res.status(200).send('댓글이 성공적으로 수정되었습니다.');
    } catch (error) {
        console.error(error);
        res.status(500).send('댓글 수정 중 오류가 발생했습니다.');
    }
});

// 댓글 삭제 처리
app.delete('/comment/:id/delete', async (req, res) => {
    const commentId = req.params.id;

    try {
        // 댓글 삭제 로직을 구현해주세요
        // ...
        res.status(200).send('댓글이 성공적으로 삭제되었습니다.');
    } catch (error) {
        console.error(error);
        res.status(500).send('댓글 삭제 중 오류가 발생했습니다.');
    }
});

// 채팅 기능
