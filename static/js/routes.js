//db 정보 가져오기
const db = require('./db');
const multer = require('multer');
const fs = require('fs');

//파일 업로드 관련
const upload = multer({
    storage: multer.diskStorage({
        destination: function (req, file, callback) {
            if (!fs.existsSync('./uploads')) {
                fs.mkdirSync('./uploads', { recursive: true });
            }
            callback(null, './uploads');
        },
        filename: function (req, file, callback) {
            // 파일 이름을 고유하고 안전하게 변환
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            const safeFileName = file.originalname
                .replace(/[^a-zA-Z0-9.\-_]/g, '_'); // 특수문자를 _로 변환
            callback(null, uniqueSuffix + '-' + safeFileName);
        }
    })
});

module.exports = function (app, session, isAuthenticated) {
  app.get('/', function (req, res) {
      res.render('template/index.html');
  });

  app.get('/signup', function (req, res) {
      res.render('template/signup.html');
  });

  app.get('/login', function (req, res) {
      res.render('template/login.html');
  });

  app.get('/projects', isAuthenticated, async (req, res) => {
      try {
        const [projects] = await db.execute("SELECT id, title, username,likes, views, (select count(*) from comments where comments.post_id = posts.id) as comments, date_format(created_at, '%Y-%m-%d') as date from posts order by created_at DESC");
        res.render('template/projects.html', { projects });
      } catch (error) {
          console.error("프로젝트 목록을 가져오는 중 에러:", error);
          res.status(500).send("서버 에러");
      }
  });


  app.get('/view_project', isAuthenticated, async (req, res) => {
    const projectId = req.query.id;
    if (!projectId) {
        return res.status(400).send('잘못된 접근입니다.');
    }
    try {
        // 조회수 증가
        await db.execute('UPDATE posts SET views = views + 1 WHERE id = ?', [projectId]);
        const [rows] = await db.execute("SELECT id, title, tags, content, likes, views, (select count(*) from comments where comments.post_id = posts.id) as comments, date_format(created_at, '%Y-%m-%d') as date, file_path, username from posts where id = ? ", [projectId]);
        if (rows.length === 0) {
            return res.status(404).send('Project not found');
        }

        const [commentRows] = await db.execute(`SELECT username, content, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS date FROM comments WHERE post_id = ? ORDER BY created_at ASC`,[projectId]);

        res.render('template/view_project.html', { project: rows[0], comments: commentRows });
    } catch (error) {
        console.error('프로젝트 조회 중 에러:', error);
        res.status(500).send('서버 에러가 발생했습니다.');
    }
    //   const projectDetails = {
    //       id: 1,
    //       title: "Project A",
    //       description: "Detailed Description of Project A",
    //       created_at: "2024-01-01", 
    //       username: "User123"
    //   };
  });

  //좋아요 기능 -> 계정당 한번만 할 수 있음.
  app.post('/like_project', isAuthenticated, async (req, res) => {
    const projectId = req.body.id;
    const userId = req.session.user.id;

    if (!projectId) {
        console.error('No Project ID provided');
        return res.status(400).json({ message: '잘못된 접근입니다.' });
    }

    try {
        const [existingLike] = await db.execute(
            'SELECT * FROM post_likes WHERE user_id = ? AND post_id = ?',
            [userId, projectId]
        );

        if (existingLike.length > 0) {
            return res.status(400).json({ message: '계정당 좋아요는 한번만 가능합니다.' });
        }

        await db.execute(
            'INSERT INTO post_likes (user_id, post_id) VALUES (?, ?)',
            [userId, projectId]
        );

        await db.execute(
            'UPDATE posts SET likes = likes + 1 WHERE id = ?',
            [projectId]
        );

        return res.status(200).json({ message: '좋아요!!!!' });
    } catch (error) {
        console.error('좋아요 처리 중 에러:', error);
        return res.status(500).json({ message: '서버 에러가 발생했습니다.' });
    }
});

//댓글 추가
app.post('/add_comment', isAuthenticated, async (req, res) => {
    const { content, projectId } = req.body;
    const { username, user_id } = req.session.user;

    if (!content || !projectId) {
        return res.status(400).send({ message: 'Content and Project ID are required' });
    }

    try {
        const [result] = await db.execute(
            `INSERT INTO comments (post_id, user_id, username, content) VALUES (?, ?, ?, ?)`,
            [projectId, user_id, username, content]
        );

        const [newComment] = await db.execute(
            `SELECT 
                username, 
                content, 
                DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at 
             FROM comments 
             WHERE id = ?`,
            [result.insertId]
        );

        res.status(200).send({ message: '댓글이 추가되었습니다.', comment: newComment[0] });
    } catch (error) {
        console.error('댓글 추가 중 에러:', error);
        res.status(500).send({ message: '서버 에러가 발생했습니다.' });
    }
});
//파일 다운로드
app.get('/download', isAuthenticated, async (req, res) => {
    const projectId = req.query.id; // 다운로드하려는 프로젝트 ID

    if (!projectId) {
        return res.status(400).send('Project ID is required');
    }

    try {
        // 데이터베이스에서 파일 경로를 가져옴
        const [rows] = await db.execute(
            'SELECT file_path FROM posts WHERE id = ?',
            [projectId]
        );

        if (rows.length === 0) {
            return res.status(404).send('File not found');
        }

        const filePath = rows[0].file_path;

        // 파일이 실제 서버 디렉토리에 있는지 확인
        if (!fs.existsSync(filePath)) {
            return res.status(404).send('File does not exist on the server');
        }

        // 파일 다운로드
        res.download(filePath, (err) => {
            if (err) {
                console.error('파일 다운로드 중 에러:', err);
                res.status(500).send('파일 다운로드 중 문제가 발생했습니다.');
            }
        });
    } catch (error) {
        console.error('파일 다운로드 중 에러:', error);
        res.status(500).send('서버 에러가 발생했습니다.');
    }
});

  //여기는 인쓰는 부분이 됨.
//   app.get('/projects_plus', isAuthenticated, async (req, res) => {
//       try {
//         const [projects] = await db.execute("SELECT id, title, username,likes, views, (select count(*) from comments where comments.post_id = posts.id) as comments, date_format(created_at, '%Y-%m-%d') as date from posts order by created_at DESC");
//         res.render('template/projects_plus.html', { projects });
//       } catch (error) {
//           console.error("프로젝트 목록을 가져오는 중 에러:", error);
//           res.status(500).send("서버 에러");
//       }
//   });

  app.get('/create_project', isAuthenticated, async (req, res) => {
    const { username, id: user_id} = req.session.user;

    try {
        res.render('template/create_project.html', { username, user_id });
    } catch (error) {
        console.error("프로젝트 생성 중 에러:", error);
        res.status(500).send("서버 에러");
    }
  });

  app.post('/create_project', isAuthenticated, upload.single('file'), async (req, res)=> {
    const { title, content, tags } = req.body;
    const { username, user_id } = req.session.user;
    const file_path = req.file ? req.file.path : null;

    console.log("debug용 출력", {
        title,
        category: "프로젝트",
        content,
        file_path,
        tags,
        username,
        user_id
    });
    
    try {
        // DB에 데이터 삽입
        await db.execute(
            "INSERT INTO posts (category, title, content, file_path, tags, username, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
            ["프로젝트", title, content, file_path, tags , username, user_id]
        );

        res.redirect('/projects');
    } catch (error) {
        console.error("프로젝트 생성 중 에러:", error);
        res.status(500).send("서버 에러");
    }

  })
  
  

  app.get('/create_discussion', function (req, res) {
      res.render('template/create_discussion.html');
  });

  app.get('/discussions', isAuthenticated, (req, res) => {
      const discussions = [
          { id: 1, title: "Discussion A", username: "User1", created_at: "2024-01-01" },
          { id: 2, title: "Discussion B", username: "User2", created_at: "2024-01-02" },
          { id: 3, title: "Discussion C", username: "User3", created_at: "2024-01-03" }
      ];

      res.render('template/discussions.html', { discussions });
  });

  app.get('/discussions_plus', function (req, res) {
      res.render('template/discussions_plus.html');
  });

  app.get('/view_discussion', function (req, res) {
      res.render('template/view_discussion.html');
  });

  app.get('/index', function (req, res) {
      res.render('template/index.html');
  });

  app.get('/search', function (req, res) {
      res.render('template/search.html');
  });

  app.get('/mypage', isAuthenticated, (req, res) => {
      const userinfo = req.session.user;
      res.render('template/mypage.html', { userinfo });
  });

  app.post('/api/auth/userinfo', isAuthenticated, (req, res) => {
      if (req.session.isLoggedIn) {
          res.json(req.session.user);
      } else {
          res.status(401).json({ message: '사용자를 찾을 수 없습니다.' });
      }
  });

  app.get('/api/auth/status', (req, res) => {
      if (req.session.isLoggedIn) {
          res.json({
              isLoggedIn: true,
              user: {
                  id: req.session.user.id,
                  username: req.session.user.username
              }
          });
      } else {
          res.json({
              isLoggedIn: false,
              user: null
          });
      }
  });

//   // 로그인을 처리하는 라우트 추가
//   app.post('/login/auth', async (req, res) => {
//       const { username, password } = req.body;

//       // 테스트용
//       if (username === "testUser" && password === "password123") {
//           req.session.isLoggedIn = true;
//           req.session.user = { id: 1, username };
//           res.json({ message: '로그인 성공' });
//       } else {
//           res.json({ message: '로그인 실패' });
//       }
//   });
}
