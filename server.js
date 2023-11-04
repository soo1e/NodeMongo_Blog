// Library
const express = require('express')
const app = express()
app.use(express.json())
app.use(express.urlencoded({extended:true}))


// ejs 연결
app.set('view engine', 'ejs')

// public 폴더 연결
app.use(express.static(__dirname + '/public'));

// db 연동
const { MongoClient, ObjectId } = require('mongodb')

let db
const url = 'mongodb+srv://admin:qwer1234@cluster0.wffbp6u.mongodb.net/?retryWrites=true&w=majority'
new MongoClient(url).connect().then((client)=>{
    console.log('DB 연결 성공')
    db = client.db('forum')
}).catch((err)=>{
    console.log(err)
})


// 실제 서버
app.listen(8080, () => {
    console.log('http://localhost:8080 에서 서버 실행중')
})

// 메인 페이지
app.get('/', async (req, res) => {
    let result = await db.collection('post').find().toArray()
    // db.collection('post').find().toArray() 실행 될 때까지 기다려주세요!
    res.render('main.ejs', { 글목록 : result })
})

// 메인 페이지 html 파일 보내기!
app.get('/main', function(요청, 응답) {
    응답.sendFile(__dirname + '/index.html')
})


// 뉴스 페이지
app.get('/news', (req, res)=>{
    res.send('오늘은 비가 옵니다')
})

app.get('/shop', (req, res)=>{
    res.send('쇼핑 페이지입니다')
})


// 리스트 페이지
app.get('/list', async (req, res) => {
    let result = await db.collection('post').find().toArray()
    // db.collection('post').find().toArray() 실행 될 때까지 기다려주세요!
    res.render('list.ejs', { 글목록 : result })
})

// 글 작성 페이지
app.get('/write', (req, res) => {
    res.render('write.ejs')
})

app.post('/add', async (req, res) => {
    try {
        if (req.body.title == '' || !req.body.content) {
            // 클라이언트에게 메시지를 응답으로 보내기
            res.status(400).send('제목과 내용을 입력해주세요.');
        } else {
            await db.collection('post').insertOne({ title: req.body.title, content: req.body.content });
            // 리다이렉트 대신 응답으로 성공 상태 전송
            res.status(200).send('게시물이 성공적으로 추가되었습니다.');
        }
    } catch (err) {
        console.log(err);
        // 에러가 발생한 경우 에러 응답 보내기
        res.status(500).send('서버 에러 발생');
    }
});

// 상세 페이지 /detail/글번호로 만들기
app.get('/detail/:id', async (req, res) => {
    try {
        let result = await db.collection('post').findOne({ _id : new ObjectId(req.params.id) })
        if (result == null) {
            res.status(400).send('해당되는 글이 없습니다.')
        } else {
            res.render('detail.ejs', { result : result })
        }

    } catch (e){
        res.send('에러를 입력하지 마세요.')
    }

})
