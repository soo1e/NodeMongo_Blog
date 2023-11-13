// Library
const express = require('express')
const app = express()
app.use(express.json())
app.use(express.urlencoded({extended:true}))

const session = require('express-session')
const passport = require('passport')
const LocalStrategy = require('passport-local')
const MongoStore = require('connect-mongo')


const { createServer } = require('http');
const { Server } = require('socket.io');
const server = createServer(app);
const io = new Server(server)


require('dotenv').config()

// express-session 미들웨어 등록
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

// passport 초기화 및 세션 설정
app.use(passport.initialize());
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
            const fileKey = req.user.username + '/' + Date.now().toString(); // 업로드시 파일명 변경가능
            cb(null, fileKey);
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
server.listen(process.env.PORT, () => {
    console.log('http://localhost:3000 에서 서버 실행중')
})

// 메인 페이지
app.get('/', async (req, res) => {
    let result = await db.collection('post').find().toArray();
    // db.collection('post').find().toArray() 실행 될 때까지 기다려주세요!
    res.render('main.ejs', { result : result })
})

// 리스트 페이지
app.get('/list', async (req, res) => {
    let result = await db.collection('post').find().sort({ date: -1 }).toArray();
    // db.collection('post').find().sort({ date: -1 }).toArray() 실행 될 때까지 기다려주세요!

    // total 페이지 수 계산 (예: 한 페이지에 5개의 글을 표시한다고 가정)
    const postsPerPage = 5;
    const totalPages = Math.ceil(result.length / postsPerPage);

    res.render('list.ejs', { result: result, totalPages: totalPages });
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
                return res.status(400).send('제목과 내용을 입력해주세요.');
            }

            let postData = {
                title: req.body.title,
                content: req.body.content,
                date: new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }), // 한국 시간으로 변환
                user: req.user._id,
                username: req.user.username,
                usernick: req.user.usernick,
            };

            if (req.file) {
                postData.img = req.file.location;
            }

            await db.collection('post').insertOne(postData);
            res.redirect('/list');
        } catch (err) {
            console.log(err);
            res.status(500).render('error.ejs', { errorMessage: '서버 에러가 발생했습니다.' });
        }
    } else {
        res.redirect('/login');
    }
});

// 상세 페이지 /detail/글번호로 만들기
app.get('/detail/:id', async (req, res) => {
    try {
        let result = await db.collection('post').findOne({ _id : new ObjectId(req.params.id) })
        let result2 = await db.collection('comment').find({ parentID : new ObjectId(req.params.id) }).toArray() // 댓글 데이터 가져오기

        if (result == null) {
            res.status(500).render('error.ejs', { errorMessage: '해당되는 글이 없습니다' });
        } else {
            res.render('detail.ejs', { result: result, result2: result2 }); // 댓글 데이터를 템플릿에 전달
        }
    } catch (e) {
        res.status(505).render('error.ejs', { errorMessage: '에러가 발생했습니다.' });
    }
});

// 글 수정 페이지
app.get('/edit/:id', async (req, res) => {
    let result = await db.collection('post').findOne({ _id : new ObjectId(req.params.id) })
    res.render('edit.ejs', { result : result })
})

app.post('/edit/:id', upload.single('img1'), async (req, res) => {
    const postId = req.params.id;
    const updatedData = {
        title: req.body.title,
        content: req.body.content,
        user: req.user._id,
        username: req.user.username,
        usernick: req.user.usernick,
    };

    if (req.file) {
        // 이미지가 업로드된 경우에만 업데이트
        updatedData.img = req.file.location;
        console.log('Updated image URL:', req.file.location);
    }

    try {
        const post = await db.collection('post').findOne({ _id: new ObjectId(postId) });

        await db.collection('post').updateOne(
                { _id: new ObjectId(postId), username: req.user.username, user: req.user._id },
                { $set: updatedData }
            );

            console.log('Post updated successfully.');

        res.redirect('/list');
    } catch (error) {
        console.error(error);
        res.status(500).render('error.ejs', { errorMessage: '서버 에러가 발생했습니다.' });
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
        res.status(500).render('error.ejs', { errorMessage: '서버 에러가 발생했습니다.' });
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
            .sort({ date: -1 }) // 최신 글이 맨 위에 오도록 정렬
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
        res.status(500).render('error.ejs', { errorMessage: '서버 에러가 발생했습니다.' });
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
        if (error) return res.status(500).json({ error: '서버 오류가 발생했습니다.' });

        if (!user) {
            // 로그인 실패 시 메시지를 세션에 저장
            req.session.loginError = '아이디 또는 비밀번호를 잘못 입력했습니다. 입력하신 내용을 다시 확인해주세요.';
            return res.status(401).json({ error: '아이디 또는 비밀번호를 잘못 입력했습니다. 입력하신 내용을 다시 확인해주세요.' });
        }

        // 입력된 비밀번호를 해시로 변환하여 비교
        bcrypt.compare(req.body.password, user.password, (err, result) => {
            if (err) return res.status(500).json({ error: '서버 오류가 발생했습니다.' });

            if (result) {
                req.logIn(user, (err) => {
                    if (err) return next(err);
                    res.json({ success: true });
                });
            } else {
                // 비밀번호 불일치 시 메시지를 세션에 저장
                req.session.loginError = '아이디(로그인 전용 아이디) 또는 비밀번호를 잘못 입력했습니다. 입력하신 내용을 다시 확인해주세요.';
                res.status(401).json({ error: '아이디(로그인 전용 아이디) 또는 비밀번호를 잘못 입력했습니다.' });
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
    const usernick = req.body.usernick;

    // 예외 처리: username 또는 usernick이 빈칸일 때
    if (!username || username.trim() === '' || !usernick || usernick.trim() === '') {
        return res.status(400).json({ error: '사용자 이름과 닉네임을 입력하세요.' });
    }

    // 예외 처리: username 또는 usernick이 이미 DB에 있을 때
    const existingUser = await db.collection('user').findOne({
        $or: [
            { username: username },
            { usernick: usernick }
        ]
    });

    if (existingUser) {
        const existingField = existingUser.username === username ? '아이디' : '닉네임';
        return res.status(400).json({ error: `이미 존재하는 ${existingField}입니다.` });
    }

    // 예외 처리: password가 짧을 때
    if (!password || password.length < 6) {
        return res.status(400).json({ error: '비밀번호는 최소 6자 이상이어야 합니다.' });
    }

    // 새로운 사용자 등록
    await db.collection('user').insertOne({
        username: username,
        usernick: usernick,
        password: hash
    });

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
    try {
        let user = req.user;

        if (!user) {
            // 로그인되지 않은 경우 처리
            return res.status(401).render('error.ejs', { errorMessage: '로그인이 필요합니다' +
                    '.' });
        }

        let result = await db.collection('comment').insertOne({
            content: req.body.content,
            writerID: new ObjectId(user._id),
            writer: user.usernick, // usernick 저장
            parentID: new ObjectId(req.body.parentId),
            date: new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }), // 한국 시간으로 변환
        });

        res.redirect('back');
    } catch (error) {
        console.error(error);
        res.status(500).render('error.ejs', { errorMessage: '댓글 저장 중에 오류가 발생했습니다.' });
    }
});

app.delete('/deleteComment/:commentId', async (req, res) => {
    try {
        let user = req.user;

        if (!user) {
            // 로그인되지 않은 경우 처리
            return res.status(401).send('로그인이 필요합니다.');
        }

        let commentId = req.params.commentId;

        // 댓글 작성자와 현재 로그인한 사용자의 ID를 비교하여 권한 확인
        let comment = await db.collection('comment').findOne({ _id: new ObjectId(commentId) });
        if (!comment || comment.writerID.toString() !== user._id.toString()) {
            // 댓글이 없거나 삭제 권한이 없는 경우
            return res.status(403).send('삭제할 수 있는 권한이 없습니다.');
        }

        // 댓글 삭제
        await db.collection('comment').deleteOne({ _id: new ObjectId(commentId) });

        res.status(200).send('댓글이 삭제되었습니다.');
    } catch (error) {
        console.error(error);
        res.status(500).send('댓글 삭제 중에 오류가 발생했습니다.');
    }
});
