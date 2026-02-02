const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    maxHttpBufferSize: 1e7,
    cors: { origin: "*" } 
});

// Koneksi MongoDB (Pakai koneksi kamu)
const MONGO_URI = "mongodb+srv://dafanation999_db_user:21pOZfo7x5pmJQ4o@cluster0.0digr6d.mongodb.net/?appName=Cluster0";
mongoose.connect(MONGO_URI)
    .then(() => console.log("MongoDB Connected"))
    .catch(err => console.error("MongoDB Error:", err));

// Pengaturan Path Absolut agar Vercel tidak bingung mencari folder
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(session({
    secret: 'premium-chat-secret-key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } 
}));

// Schemas
const User = mongoose.model('User', new mongoose.Schema({
    username: { type: String, unique: true },
    password: { type: String },
    displayName: String,
    profilePic: { type: String, default: 'https://cdn-icons-png.flaticon.com/512/149/149071.png' }
}));

const Message = mongoose.model('Message', new mongoose.Schema({
    senderId: String,
    senderName: String,
    to: { type: String, default: 'public' },
    text: String,
    image: String,
    timestamp: { type: Date, default: Date.now }
}));

// --- ROUTES ---
app.get('/', (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    res.render('index', { user: req.session.user });
});

app.get('/login', (req, res) => {
    res.render('login');
});

app.post('/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ username, password: hashedPassword, displayName: username });
        await user.save();
        res.json({ success: true });
    } catch (e) { res.status(400).json({ error: "Username sudah ada" }); }
});

app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        if (user && await bcrypt.compare(password, user.password)) {
            req.session.userId = user._id;
            req.session.user = user;
            res.json({ success: true });
        } else { res.status(400).json({ error: "Login Gagal" }); }
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

app.get('/api/users', async (req, res) => {
    const users = await User.find({}, 'displayName profilePic');
    res.json(users);
});

app.get('/api/messages/:targetId', async (req, res) => {
    const { targetId } = req.params;
    const myId = req.session.userId;
    let query = { to: 'public' };
    if (targetId !== 'public') {
        query = { $or: [{ senderId: myId, to: targetId }, { senderId: targetId, to: myId }] };
    }
    const messages = await Message.find(query).sort({ timestamp: 1 });
    res.json(messages);
});

app.post('/api/update-profile', async (req, res) => {
    const { displayName, profilePic } = req.body;
    const user = await User.findByIdAndUpdate(req.session.userId, { displayName, profilePic }, { new: true });
    req.session.user = user;
    res.json(user);
});

// --- SOCKET.IO ---
let onlineUsers = {};
io.on('connection', (socket) => {
    socket.on('join', (userId) => {
        socket.userId = userId;
        onlineUsers[userId] = socket.id;
    });
    socket.on('send_message', async (data) => {
        const msg = new Message(data);
        await msg.save();
        if (data.to === 'public') io.emit('new_message', msg);
        else {
            if (onlineUsers[data.to]) io.to(onlineUsers[data.to]).emit('new_message', msg);
            socket.emit('new_message', msg);
        }
    });
    socket.on('disconnect', () => { delete onlineUsers[socket.userId]; });
});

// Jalankan server jika tidak di Vercel (Lokal/Termux)
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => console.log(`Server on port ${PORT}`));
}

// EKSPOR UNTUK VERCEL
module.exports = app;
