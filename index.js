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
    maxHttpBufferSize: 1e7, // Mendukung upload file hingga 10MB
    cors: { origin: "*" } 
});

// Koneksi MongoDB
const MONGO_URI = "mongodb+srv://dafanation999_db_user:21pOZfo7x5pmJQ4o@cluster0.0digr6d.mongodb.net/?appName=Cluster0";
mongoose.connect(MONGO_URI)
    .then(() => console.log("MongoDB Connected"))
    .catch(err => console.error("MongoDB Error:", err));

// Pengaturan View Engine & Path Absolut (Penting agar Vercel tidak Error 500)
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
    cookie: { secure: false } // Ubah ke true jika menggunakan SSL/HTTPS penuh
}));

// Schemas
const User = mongoose.model('User', new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    displayName: String,
    profilePic: { type: String, default: 'https://cdn-icons-png.flaticon.com/512/149/149071.png' }
}));

const Message = mongoose.Schema({
    senderId: String,
    senderName: String,
    to: { type: String, default: 'public' },
    text: String,
    image: String,
    timestamp: { type: Date, default: Date.now }
});
const MessageModel = mongoose.model('Message', Message);

// --- ROUTES ---

// Halaman Utama
app.get('/', (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    res.render('index', { user: req.session.user });
});

// Halaman Login
app.get('/login', (req, res) => {
    res.render('login');
});

// API Register
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ 
            username, 
            password: hashedPassword, 
            displayName: username 
        });
        await user.save();
        res.json({ success: true });
    } catch (e) { 
        res.status(400).json({ error: "Username sudah digunakan!" }); 
    }
});

// API Login
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await User.findOne({ username });
        if (user && await bcrypt.compare(password, user.password)) {
            req.session.userId = user._id;
            req.session.user = user;
            res.json({ success: true });
        } else {
            res.status(400).json({ error: "Username atau Password salah!" });
        }
    } catch (e) {
        res.status(500).json({ error: "Terjadi kesalahan server" });
    }
});

// API Logout
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// API Ambil Daftar User
app.get('/api/users', async (req, res) => {
    try {
        const users = await User.find({}, 'displayName profilePic');
        res.json(users);
    } catch (e) { res.status(500).send(e); }
});

// API Ambil Riwayat Chat
app.get('/api/messages/:targetId', async (req, res) => {
    const { targetId } = req.params;
    const myId = req.session.userId;
    let query = { to: 'public' };

    if (targetId !== 'public') {
        query = {
            $or: [
                { senderId: myId, to: targetId },
                { senderId: targetId, to: myId }
            ]
        };
    }

    try {
        const messages = await MessageModel.find(query).sort({ timestamp: 1 }).limit(100);
        res.json(messages);
    } catch (e) { res.status(500).send(e); }
});

// API Update Profil
app.post('/api/update-profile', async (req, res) => {
    const { displayName, profilePic } = req.body;
    try {
        const user = await User.findByIdAndUpdate(
            req.session.userId, 
            { displayName, profilePic }, 
            { new: true }
        );
        req.session.user = user;
        res.json(user);
    } catch (e) { res.status(500).send(e); }
});

// --- SOCKET.IO ---
let onlineUsers = {};

io.on('connection', (socket) => {
    socket.on('join', (userId) => {
        socket.userId = userId;
        onlineUsers[userId] = socket.id;
    });

    socket.on('send_message', async (data) => {
        // Simpan ke MongoDB
        const msg = new MessageModel({
            senderId: data.senderId,
            senderName: data.senderName,
            to: data.to,
            text: data.text,
            image: data.image
        });
        await msg.save();

        // Kirim Real-time
        if (data.to === 'public') {
            io.emit('new_message', msg);
        } else {
            const receiverSid = onlineUsers[data.to];
            const senderSid = onlineUsers[data.senderId];
            if (receiverSid) io.to(receiverSid).emit('new_message', msg);
            if (senderSid) io.to(senderSid).emit('new_message', msg);
        }
    });

    socket.on('disconnect', () => {
        delete onlineUsers[socket.userId];
    });
});

// Jalankan Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Export untuk Vercel
module.exports = server;
