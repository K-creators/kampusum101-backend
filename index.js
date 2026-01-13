require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const mongoose = require('mongoose');
const app = express();

const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// MONGODB
const MONGO_URI = "mongodb+srv://admin:kampusum123@cluster0.dzud8wf.mongodb.net/?appName=Cluster0";
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ Veritabanı Bağlandı"))
    .catch(err => console.error("❌ Veritabanı Hatası:", err));

// --- ŞEMALAR ---
const KullaniciSchema = new mongoose.Schema({
    adSoyad: String,
    kullaniciAdi: String,
    email: String,
    sifre: String,
    bolum: { type: String, default: "Genel" },
    bio: { type: String, default: "" },
    resimUrl: String,
    takipciler: [String],
    takipEdilenler: [String],
    createdAt: { type: Date, default: Date.now }
});
const Kullanici = mongoose.model('Kullanici', KullaniciSchema);

const MesajSchema = new mongoose.Schema({
    gonderenId: String,
    aliciId: String,
    icerik: String,
    tarih: { type: Date, default: Date.now }
});
const Mesaj = mongoose.model('Mesaj', MesajSchema);

const GonderiSchema = new mongoose.Schema({
    yazarId: String,
    yazar: String,
    kullaniciAdi: String,
    bolum: String,
    profilResim: String,
    icerik: String,
    resimUrl: String,
    tarih: String,
    begeni: { type: Number, default: 0 },
    begenenler: [String],
    yorumlar: [{
        yazar: String,
        icerik: String,
        profilResim: String,
        tarih: String
    }]
});
const Gonderi = mongoose.model('Gonderi', GonderiSchema);

// CLOUDINARY
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: { folder: 'kampusum101_uploads', allowed_formats: ['jpg', 'png', 'jpeg', 'heic'] },
});
const upload = multer({ storage: storage });

const tarihGetir = () => {
    const d = new Date();
    return d.toLocaleDateString('tr-TR') + ' ' + d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
};

// --- ROTALAR ---

app.get('/', (req, res) => res.send('API Aktif'));

// 1. KAYIT
app.post('/api/kayit', async (req, res) => {
    const { adSoyad, kullaniciAdi, email, sifre } = req.body;
    const emailVar = await Kullanici.findOne({ email });
    if (emailVar) return res.status(400).json({ durum: 'hata', mesaj: 'E-posta zaten kayıtlı!' });
    const nickVar = await Kullanici.findOne({ kullaniciAdi });
    if (nickVar) return res.status(400).json({ durum: 'hata', mesaj: 'Kullanıcı adı alınmış!' });

    const yeniKullanici = new Kullanici({ 
        adSoyad, kullaniciAdi, email, sifre, bolum: "Öğrenci", resimUrl: "" 
    });
    await yeniKullanici.save();
    res.json({ durum: 'basarili', mesaj: 'Kayıt başarılı! Giriş yapabilirsiniz.' });
});

// 2. GİRİŞ
app.post('/api/giris', async (req, res) => {
    const { email, sifre } = req.body;
    const k = await Kullanici.findOne({ email, sifre });
    if (k) res.json({ durum: 'basarili', kullanici: k });
    else res.status(401).json({ durum: 'hata', mesaj: 'Hatalı bilgiler' });
});

// 3. MESAJLAŞMA
app.post('/api/mesaj-gonder', async (req, res) => {
    const { gonderenId, aliciId, icerik } = req.body;
    await new Mesaj({ gonderenId, aliciId, icerik }).save();
    res.json({ durum: 'basarili' });
});

app.get('/api/mesajlar/:uid1/:uid2', async (req, res) => {
    const { uid1, uid2 } = req.params;
    const mesajlar = await Mesaj.find({
        $or: [ { gonderenId: uid1, aliciId: uid2 }, { gonderenId: uid2, aliciId: uid1 } ]
    }).sort({ tarih: 1 });
    res.json(mesajlar);
});

// Sohbet Listesi
app.get('/api/sohbet-gecmisi/:myId', async (req, res) => {
    const users = await Kullanici.find({ _id: { $ne: req.params.myId } });
    res.json(users);
});

// 4. ŞİFRE DEĞİŞTİRME
app.post('/api/sifre-degistir', async (req, res) => {
    const { userId, eskiSifre, yeniSifre } = req.body;
    const k = await Kullanici.findById(userId);
    if(k && k.sifre === eskiSifre) {
        k.sifre = yeniSifre;
        await k.save();
        res.json({ durum: 'basarili' });
    } else {
        res.status(400).json({ durum: 'hata', mesaj: 'Eski şifre hatalı' });
    }
});

// 5. PROFİL & GÖNDERİ İŞLEMLERİ
app.post('/api/profil-guncelle', upload.single('resim'), async (req, res) => { 
    const { id, adSoyad, kullaniciAdi, bolum, bio } = req.body;
    const resimUrl = req.file ? req.file.path : undefined;
    const guncelVeri = { adSoyad, kullaniciAdi, bolum, bio };
    if (resimUrl) guncelVeri.resimUrl = resimUrl;
    
    const yeniProfil = await Kullanici.findByIdAndUpdate(id, guncelVeri, { new: true });
    res.json({ durum: 'basarili', yeniProfil });
});

app.post('/api/gonderi-paylas', upload.single('resim'), async (req, res) => { 
    const {icerik, yazar, kullaniciAdi, bolum, profilResim, yazarId} = req.body;
    const resimUrl = req.file ? req.file.path : null;
    await new Gonderi({
        yazarId, yazar, kullaniciAdi, bolum, profilResim, icerik, resimUrl, tarih: tarihGetir()
    }).save();
    res.json({ durum: 'basarili' });
});

app.get('/api/akis', async (req, res) => { 
    res.json(await Gonderi.find().sort({ _id: -1 })); 
});

app.post('/api/gonderi/:id/yorum', async (req, res) => {
    const { id } = req.params;
    const { icerik, yazar, profilResim } = req.body;
    const g = await Gonderi.findById(id);
    if(g) {
        g.yorumlar.push({ yazar, icerik, tarih: tarihGetir() });
        await g.save();
        res.json({ durum: 'basarili', yorumlar: g.yorumlar });
    } else res.status(404).json({ durum: 'hata' });
});

// --- İŞTE EKSİK OLAN VE SORUN ÇIKARAN ROTALAR BURADA ---

// Profil Sayfası İçin Kullanıcı Bilgisi Çekme
app.get('/api/kullanici/:id', async (req, res) => {
    try {
        const k = await Kullanici.findById(req.params.id);
        if(k) res.json(k);
        else res.status(404).json({});
    } catch(e) { res.status(404).json({}); }
});

// Profil Sayfasında "Gönderilerim" Kısmı
app.get('/api/gonderilerim', async (req, res) => { 
    const y = req.query.yazar; 
    const gonderiler = await Gonderi.find({ yazar: y }).sort({ _id: -1 });
    res.json(gonderiler); 
});

// Gönderi Beğenme
app.post('/api/gonderi/:id/begen', async (req, res) => {
    const { id } = req.params;
    const { yazar } = req.body;
    try {
        const g = await Gonderi.findById(id);
        if(g) {
            if(!g.begenenler.includes(yazar)) { g.begenenler.push(yazar); g.begeni++; }
            else { g.begenenler = g.begenenler.filter(x => x !== yazar); g.begeni--; }
            await g.save();
            res.json({ durum: 'basarili' });
        } else res.status(404).json({ durum: 'hata' });
    } catch(e) { res.status(500).json({ durum: 'hata' }); }
});

// Gönderi Silme
app.delete('/api/gonderi-sil/:id', async (req, res) => {
    try {
        await Gonderi.findByIdAndDelete(req.params.id);
        res.json({ durum: 'basarili' });
    } catch(e) { res.status(500).json({ durum: 'hata' }); }
});
app.delete('/api/gonderi/:gonderiId/yorum/:yorumId', async (req, res) => {
    try {
        const { gonderiId, yorumId } = req.params;
        // Gonderi içindeki yorumlar dizisinden, o id'li yorumu çekip çıkarır ($pull)
        await Gonderi.findByIdAndUpdate(gonderiId, {
            $pull: { yorumlar: { _id: yorumId } }
        });
        res.json({ durum: 'basarili' });
    } catch (e) {
        res.status(500).json({ durum: 'hata' });
    }
});
app.listen(port, () => console.log(`Sunucu ${port} portunda!`));