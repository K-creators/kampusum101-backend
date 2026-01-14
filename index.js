require('dotenv').config();
const nodemailer = require('nodemailer');
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
    
    // YENİ EKLENENLER:
    onayKodu: String, // 6 haneli kod
    onaylandi: { type: Boolean, default: false }, // Hesap onaylı mı?
    
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

// AŞAMA 1: Kaydı Başlat (Güncellenmiş Mantık)
app.post('/api/kayit-baslat', async (req, res) => {
    const { adSoyad, kullaniciAdi, email, sifre } = req.body;

    // EDU.TR KONTROLÜ
    if (!email.endsWith('.edu.tr')) {
        return res.status(400).json({ durum: 'hata', mesaj: 'Sadece .edu.tr uzantılı mail adresleri kabul edilmektedir!' });
    }

    try {
        // 1. ONAYLI Kullanıcı Kontrolü (Gerçekten alınmış mı?)
        // Hem maile hem kullanıcı adına bakıyoruz. Eğer ONAYLI biri varsa hata ver.
        const onayliVar = await Kullanici.findOne({ 
            $or: [{ email }, { kullaniciAdi }], 
            onaylandi: true 
        });

        if (onayliVar) {
            if (onayliVar.email === email) return res.status(400).json({ durum: 'hata', mesaj: 'Bu e-posta zaten kayıtlı ve onaylı.' });
            if (onayliVar.kullaniciAdi === kullaniciAdi) return res.status(400).json({ durum: 'hata', mesaj: 'Bu kullanıcı adı zaten kullanımda.' });
        }

        // 2. ONAYSIZ (Çöp) Kayıtları Temizle
        // Eğer aynı mail veya kullanıcı adıyla yarım kalmış bir kayıt varsa, onu silelim ki yenisini açabilelim.
        await Kullanici.deleteMany({ 
            $or: [{ email }, { kullaniciAdi }], 
            onaylandi: false 
        });

        // 3. Yeni Kaydı Oluştur (Onaysız olarak)
        const kod = Math.floor(100000 + Math.random() * 900000).toString();

        const yeni = new Kullanici({ 
            adSoyad, 
            kullaniciAdi, 
            email, 
            sifre, 
            onayKodu: kod, 
            onaylandi: false, // Henüz false
            bolum: "Öğrenci"
        });
        
        await yeni.save();

        // 4. Mail Gönder
        await transporter.sendMail({
            from: `"Kampüsüm101" <kampusum101info@gmail.com>`,
            to: email,
            subject: 'Doğrulama Kodunuz - Kampüsüm101',
            text: `Merhaba ${adSoyad}, Kampüsüm101'e hoş geldin! Doğrulama kodun: ${kod}`
        });

        res.json({ durum: 'basarili', mesaj: 'Doğrulama kodu e-postana gönderildi.' });

    } catch (error) {
        console.error("Kayıt Hatası:", error);
        res.status(500).json({ durum: 'hata', mesaj: 'Sunucu hatası: ' + error.message });
    }
});

const transporter = nodemailer.createTransport({
    host: "smtp-relay.brevo.com",
    port: 2525,
    secure: false, 
    auth: {
        // Render'daki "EMAIL_USER" değişkenini çekiyoruz
        user: process.env.EMAIL_USER, 
        // Render'daki "EMAIL_PASS" değişkenini çekiyoruz
        pass: process.env.EMAIL_PASS  
    }
});

app.post('/api/kayit-tamamla', async (req, res) => {
    const { email, kod } = req.body;
    
    const k = await Kullanici.findOne({ email });
    
    if (!k) return res.status(400).json({ durum: 'hata', mesaj: 'Kullanıcı bulunamadı.' });
    
    if (k.onayKodu === kod) {
        k.onaylandi = true;
        k.onayKodu = ""; // Kodu temizle
        await k.save();
        res.json({ durum: 'basarili', mesaj: 'Hesap doğrulandı! Giriş yapabilirsiniz.' });
    } else {
        res.status(400).json({ durum: 'hata', mesaj: 'Hatalı doğrulama kodu!' });
    }
});

// 2. GİRİŞ
app.post('/api/giris', async (req, res) => {
    const { email, sifre } = req.body;
    const k = await Kullanici.findOne({ email, sifre });
    
    if (k) {
        if (!k.onaylandi) return res.status(400).json({ durum: 'hata', mesaj: 'Lütfen önce mail adresinizi doğrulayın.' });
        res.json({ durum: 'basarili', kullanici: k });
    }
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

app.post('/api/gonderi-olustur', upload.single('resim'), async (req, res) => {
    try {
        // Frontend'den gelen verileri al
        const { yazar, yazarId, kullaniciAdi, bolum, icerik, profilResim } = req.body; 
        
        // Veritabanı objesini hazırla
        const yeniGonderi = new Gonderi({
            yazarId,
            yazar,
            kullaniciAdi,
            bolum,
            icerik,
            profilResim,
            resimUrl: req.file ? req.file.path : null, // Resim varsa ekle
            tarih: tarihGetir()
        });

        // --- İŞTE EKSİK OLAN KISIMLAR ---
        await yeniGonderi.save(); // 1. Veritabanına kaydet
        res.json({ durum: 'basarili' }); // 2. Telefona "Tamam" de
        
    } catch (e) {
        console.error("Gönderi Oluşturma Hatası:", e);
        res.status(500).json({ durum: 'hata', mesaj: e.message });
    }
});

app.get('/api/akis', async (req, res) => { 
    res.json(await Gonderi.find().sort({ _id: -1 })); 
});

app.post('/api/gonderi/:id/yorum', async (req, res) => {
    const { id } = req.params;
    // profilResim'i buradan alıyoruz
    const { icerik, yazar, profilResim } = req.body; 
    
    const g = await Gonderi.findById(id);
    if(g) {
        // Ve veritabanına itiyoruz
        g.yorumlar.push({ yazar, icerik, profilResim, tarih: tarihGetir() });
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
    try {
        const { yazarId } = req.query; // <--- ARTIK ID BEKLİYORUZ
        if(!yazarId) return res.json([]);
        
        // Veritabanında yazarId'si eşleşenleri bul
        const gonderiler = await Gonderi.find({ yazarId: yazarId }).sort({ _id: -1 });
        res.json(gonderiler);
    } catch (e) {
        res.status(500).json({ hata: e.message });
    }
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