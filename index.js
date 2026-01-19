require('dotenv').config();
const nodemailer = require('nodemailer');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const mongoose = require('mongoose');
const app = express();

// --- FIREBASE ADMIN KURULUMU ---
const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");
const SUPER_ADMIN_ID = "6962e30b6e6d834ae0fc9c8c";

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// --- YARDIMCI FONKSİYON: BİLDİRİM GÖNDER ---
async function bildirimGonder(hedefToken, baslik, icerik, data = {}) {
    if (!hedefToken) return;

    const message = {
        token: hedefToken,
        notification: {
            title: baslik,
            body: icerik
        },
        data: data
    };

    try {
        await admin.messaging().send(message);
        console.log("Bildirim gönderildi:", baslik);
    } catch (error) {
        console.log("Bildirim hatası:", error.message);
    }
}

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
    engellenenler: [String],
    fcmToken: { type: String, default: "" },
    onayKodu: String,
    onaylandi: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    sonKullaniciAdiDegisikligi: { type: Date, default: null },
    dogrulamaKodu: { type: String, default: "" }, // Hesap silme için
    ozgecmis: {
        hakkinda: { type: String, default: "" },
        okul: { type: String, default: "" },
        bolum: { type: String, default: "" },
        isTecrubesi: { type: String, default: "" },
        yetenekler: { type: String, default: "" },
        linkler: { type: String, default: "" },
        sertifikalar: [{ baslik: String, dosyaUrl: String }],
        projeler: [{ baslik: String, dosyaUrl: String }]
    },
});
const Kullanici = mongoose.model('Kullanici', KullaniciSchema);

// --- ŞİKAYET / RAPOR ŞEMASI ---
const RaporSchema = new mongoose.Schema({
    sikayetEdenId: String,
    sikayetEdilenId: String, // Kullanıcı veya Gönderi ID'si
    tur: { type: String, enum: ['gonderi', 'kullanici', 'yorum'], default: 'gonderi' },
    sebep: String,
    aciklama: { type: String, default: "" },
    tarih: { type: Date, default: Date.now },
    durum: { type: String, default: 'bekliyor' } // bekliyor, incelendi, silindi
});
const Rapor = mongoose.model('Rapor', RaporSchema);

// --- İÇERİK ŞİKAYET ETME ROTASI ---
app.post('/api/sikayet-et', async (req, res) => {
    const { sikayetEdenId, sikayetEdilenId, tur, sebep, aciklama } = req.body;

    try {
        // Aynı kişi aynı içeriği daha önce şikayet etmiş mi?
        const varMi = await Rapor.findOne({ sikayetEdenId, sikayetEdilenId, tur });
        
        if (varMi) {
            return res.status(400).json({ durum: 'hata', mesaj: 'Bunu zaten şikayet ettiniz.' });
        }

        const yeniRapor = new Rapor({
            sikayetEdenId,
            sikayetEdilenId,
            tur,
            sebep,
            aciklama
        });

        await yeniRapor.save();

        // Admin'e bildirim gönderme (Opsiyonel)
        // Burada SUPER_ADMIN_ID'ye bildirim atabilirsin.

        res.json({ durum: 'basarili', mesaj: 'Bildiriminiz alındı. Teşekkürler.' });

    } catch (error) {
        res.status(500).json({ durum: 'hata', mesaj: error.message });
    }
});

// Token İşlemleri
app.post('/api/fcm-token-kaydet', async (req, res) => {
    const { userId, token } = req.body;
    try {
        await Kullanici.findByIdAndUpdate(userId, { fcmToken: token });
        res.json({ durum: 'basarili' });
    } catch (e) {
        res.status(500).json({ durum: 'hata' });
    }
});

app.post('/api/fcm-token-sil', async (req, res) => {
    const { userId } = req.body;
    try {
        await Kullanici.findByIdAndUpdate(userId, { fcmToken: "" });
        res.json({ durum: 'basarili', mesaj: 'Bildirimler kapatıldı.' });
    } catch (e) {
        res.status(500).json({ durum: 'hata', mesaj: e.message });
    }
});

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
    }],
    pdfUrl: { type: String, default: "" },   // PDF dosya yolu
    pdfIsim: { type: String, default: "" },  // PDF'in orijinal adı
}, { timestamps: true });
const Gonderi = mongoose.model('Gonderi', GonderiSchema);

// CLOUDINARY
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: { 
        folder: 'kampusum101_uploads', 
        resource_type: 'auto', // <--- KRİTİK EKLEME: Cloudinary'nin dosya türünü (PDF/Resim) otomatik anlamasını sağlar
        allowed_formats: ['jpg', 'png', 'jpeg', 'heic', 'pdf'] 
    },
});
const upload = multer({ storage: storage });

const tarihGetir = () => {
    const d = new Date();
    return d.toLocaleDateString('tr-TR') + ' ' + d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
};

// --- ROTALAR ---

app.get('/', (req, res) => res.send('API Aktif'));

// AŞAMA 1: Kaydı Başlat
app.post('/api/kayit-baslat', async (req, res) => {
    const { adSoyad, kullaniciAdi, email, sifre } = req.body;
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;

    if (!usernameRegex.test(kullaniciAdi)) {
        return res.status(400).json({
            durum: 'hata',
            mesaj: 'Kullanıcı adı 3-20 karakter olmalı ve sadece harf, rakam veya _ içermelidir.'
        });
    }
    // EDU.TR KONTROLÜ
    if (!email.endsWith('.edu.tr')) {
        return res.status(400).json({ durum: 'hata', mesaj: 'Sadece .edu.tr uzantılı mail adresleri kabul edilmektedir!' });
    }

    try {
        const onayliVar = await Kullanici.findOne({
            $or: [{ email }, { kullaniciAdi }],
            onaylandi: true
        });

        if (onayliVar) {
            if (onayliVar.email === email) return res.status(400).json({ durum: 'hata', mesaj: 'Bu e-posta zaten kayıtlı ve onaylı.' });
            if (onayliVar.kullaniciAdi === kullaniciAdi) return res.status(400).json({ durum: 'hata', mesaj: 'Bu kullanıcı adı zaten kullanımda.' });
        }

        await Kullanici.deleteMany({
            $or: [{ email }, { kullaniciAdi }],
            onaylandi: false
        });

        const kod = Math.floor(100000 + Math.random() * 900000).toString();

        const yeni = new Kullanici({
            adSoyad,
            kullaniciAdi,
            email,
            sifre,
            onayKodu: kod,
            onaylandi: false,
            bolum: "Öğrenci"
        });

        await yeni.save();

        await transporter.sendMail({
            from: 'Kampüsüm101 <karakus.job@outlook.com>',
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
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// --- HESAP SİLME 1. AŞAMA: Şifre Kontrolü ve Kod Gönderme ---
app.post('/api/hesap-sil-baslat', async (req, res) => {
    const { userId, sifre } = req.body;

    try {
        const user = await Kullanici.findById(userId);
        if (!user) return res.status(404).json({ durum: 'hata', mesaj: 'Kullanıcı bulunamadı.' });

        if (user.sifre !== sifre) {
            return res.status(400).json({ durum: 'hata', mesaj: 'Girdiğiniz şifre yanlış!' });
        }

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        user.dogrulamaKodu = code;
        await user.save();

        const mailOptions = {
            from: 'kampusum101info@gmail.com',
            to: user.email,
            subject: 'Kampüsüm101 - Hesap Silme Onay Kodu',
            text: `Hesabınızı silmek için talepte bulundunuz.\n\nOnay Kodunuz: ${code}\n\nEğer bu işlemi siz yapmadıysanız lütfen şifrenizi değiştirin.`
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.log(error);
                return res.status(500).json({ durum: 'hata', mesaj: 'Kod gönderilemedi.' });
            }
            res.json({ durum: 'basarili', mesaj: 'Doğrulama kodu e-posta adresinize gönderildi.' });
        });

    } catch (e) {
        res.status(500).json({ durum: 'hata', mesaj: e.message });
    }
});

// --- HESAP SİLME 2. AŞAMA: Kodu Doğrula ve SİL ---
app.post('/api/hesap-sil-onayla', async (req, res) => {
    const { userId, kod } = req.body;

    try {
        const user = await Kullanici.findById(userId);
        if (!user) return res.status(404).json({ durum: 'hata', mesaj: 'Kullanıcı bulunamadı.' });

        if (user.dogrulamaKodu !== kod) {
            return res.status(400).json({ durum: 'hata', mesaj: 'Hatalı kod girdiniz!' });
        }

        await Kullanici.findByIdAndDelete(userId);
        res.json({ durum: 'basarili', mesaj: 'Hesabınız kalıcı olarak silindi. Üzgünüz, sizi özleyeceğiz.' });

    } catch (e) {
        res.status(500).json({ durum: 'hata', mesaj: e.message });
    }
});

app.post('/api/kayit-tamamla', async (req, res) => {
    const { email, kod } = req.body;
    const k = await Kullanici.findOne({ email });

    if (!k) return res.status(400).json({ durum: 'hata', mesaj: 'Kullanıcı bulunamadı.' });

    if (k.onayKodu === kod) {
        k.onaylandi = true;
        k.onayKodu = "";
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
        $or: [{ gonderenId: uid1, aliciId: uid2 }, { gonderenId: uid2, aliciId: uid1 }]
    }).sort({ tarih: 1 });
    res.json(mesajlar);
});

app.delete('/api/mesaj-sil/:id', async (req, res) => {
    try {
        const mesajId = req.params.id;
        await Mesaj.findByIdAndDelete(mesajId);
        res.json({ durum: 'basarili', mesaj: 'Mesaj silindi' });
    } catch (e) {
        res.status(500).json({ durum: 'hata', hata: e.message });
    }
});

// --- TÜM SOHBETİ SİLME ROTASI ---
app.delete('/api/sohbet-sil/:user1/:user2', async (req, res) => {
    try {
        const { user1, user2 } = req.params;
        await Mesaj.deleteMany({
            $or: [
                { gonderenId: user1, aliciId: user2 },
                { gonderenId: user2, aliciId: user1 }
            ]
        });
        res.json({ durum: 'basarili', mesaj: 'Sohbet tamamen silindi' });
    } catch (e) {
        res.status(500).json({ durum: 'hata', hata: e.message });
    }
});

// --- BİLDİRİM ŞEMASI VE GETİRME ---
const bildirimSchema = new mongoose.Schema({
    aliciId: String,
    gonderenId: String,
    tur: String,
    mesaj: String,
    okundu: { type: Boolean, default: false },
    tarih: { type: Date, default: Date.now }
});
const Bildirim = mongoose.model('Bildirim', bildirimSchema);

app.get('/api/bildirimler/:userId', async (req, res) => {
    try {
        const bildirimler = await Bildirim.find({ aliciId: req.params.userId }).sort({ tarih: -1 });
        const detayliBildirimler = await Promise.all(bildirimler.map(async (b) => {
            const gonderen = await Kullanici.findById(b.gonderenId).select('adSoyad resimUrl');
            return {
                ...b._doc,
                gonderenAdi: gonderen ? gonderen.adSoyad : 'Bilinmeyen Kullanıcı',
                gonderenResim: gonderen ? gonderen.resimUrl : null
            };
        }));
        res.json(detayliBildirimler);
    } catch (e) {
        res.status(500).json({ durum: 'hata', mesaj: e.message });
    }
});

app.get('/ping', (req, res) => {
    res.send('Pong! Sunucu ayakta 🚀');
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
    if (k && k.sifre === eskiSifre) {
        k.sifre = yeniSifre;
        await k.save();
        res.json({ durum: 'basarili' });
    } else {
        res.status(400).json({ durum: 'hata', mesaj: 'Eski şifre hatalı' });
    }
});

// 5. PROFİL GÜNCELLEME
app.post('/api/profil-guncelle', upload.single('resim'), async (req, res) => {
    const { id, adSoyad, kullaniciAdi, bolum, bio, ozgecmis } = req.body;

    try {
        const user = await Kullanici.findById(id);
        if (!user) return res.status(404).json({ durum: 'hata', mesaj: 'Kullanıcı bulunamadı' });

        // KULLANICI ADI DEĞİŞİKLİĞİ
        if (kullaniciAdi && kullaniciAdi !== user.kullaniciAdi) {
            const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
            if (!usernameRegex.test(kullaniciAdi)) {
                return res.status(400).json({ durum: 'hata', mesaj: 'Geçersiz kullanıcı adı formatı!' });
            }
            const varMi = await Kullanici.findOne({ kullaniciAdi });
            if (varMi) return res.status(400).json({ durum: 'hata', mesaj: 'Bu kullanıcı adı zaten alınmış.' });

            const bugun = new Date();
            if (user.sonKullaniciAdiDegisikligi) {
                const gecenSure = bugun - new Date(user.sonKullaniciAdiDegisikligi);
                const yediGunMs = 7 * 24 * 60 * 60 * 1000;
                if (gecenSure < yediGunMs) {
                    const kalanGun = Math.ceil((yediGunMs - gecenSure) / (24 * 60 * 60 * 1000));
                    return res.status(400).json({ durum: 'hata', mesaj: `Kullanıcı adını değiştirmek için ${kalanGun} gün daha beklemelisin.` });
                }
            }
            user.kullaniciAdi = kullaniciAdi;
            user.sonKullaniciAdiDegisikligi = bugun;
        }

        if (adSoyad) user.adSoyad = adSoyad;
        if (bolum) user.bolum = bolum;
        if (req.file) user.resimUrl = req.file.path;

        if (ozgecmis) {
            let cvData = ozgecmis;
            if (typeof ozgecmis === 'string') {
                try { cvData = JSON.parse(ozgecmis); } catch (e) { }
            }
            user.ozgecmis = { ...user.ozgecmis, ...cvData };
            if (cvData.bolum) user.bolum = cvData.bolum;
        }

        await user.save();
        res.json({ durum: 'basarili', yeniProfil: user });

    } catch (e) {
        console.log(e);
        res.status(500).json({ durum: 'hata', mesaj: e.message });
    }
});

// --- GÖNDERİ OLUŞTURMA (PDF VE RESİM DESTEKLİ - DÜZELTİLMİŞ HALİ) ---
app.post('/api/gonderi-olustur',
    upload.fields([{ name: 'resim', maxCount: 1 }, { name: 'belge', maxCount: 1 }]),
    async (req, res) => {
        try {
            const { yazarId, yazar, kullaniciAdi, bolum, icerik, profilResim } = req.body;

            let resimUrl = "";
            let pdfUrl = "";
            let pdfIsim = "";

            // Eğer Resim geldiyse
            if (req.files && req.files['resim']) {
                resimUrl = req.files['resim'][0].path; // Cloudinary path
            }

            // Eğer PDF (Belge) geldiyse
            if (req.files && req.files['belge']) {
                pdfUrl = req.files['belge'][0].path; // Cloudinary path
                pdfIsim = req.files['belge'][0].originalname;
            }

            const yeniGonderi = new Gonderi({
                yazarId,
                yazar,
                kullaniciAdi,
                bolum,
                icerik,
                profilResim,
                resimUrl,
                pdfUrl,
                pdfIsim,
                tarih: tarihGetir()
            });

            await yeniGonderi.save();
            res.json({ durum: 'basarili', gonderi: yeniGonderi });

        } catch (e) {
            console.error("Gönderi Oluşturma Hatası:", e);
            res.status(500).json({ durum: 'hata', mesaj: e.message });
        }
    }
);

app.get('/api/akis', async (req, res) => {
    res.json(await Gonderi.find().sort({ _id: -1 }));
});

app.post('/api/gonderi/:id/yorum', async (req, res) => {
    const { id } = req.params;
    const { icerik, yazar, profilResim } = req.body;

    const g = await Gonderi.findById(id);
    if (g) {
        g.yorumlar.push({ yazar, icerik, profilResim, tarih: tarihGetir() });
        await g.save();
        res.json({ durum: 'basarili', yorumlar: g.yorumlar });
    } else res.status(404).json({ durum: 'hata' });
});

// Profil Sayfası İçin Kullanıcı Bilgisi Çekme
app.get('/api/kullanici/:id', async (req, res) => {
    try {
        const k = await Kullanici.findById(req.params.id);
        if (k) res.json(k);
        else res.status(404).json({});
    } catch (e) { res.status(404).json({}); }
});

// Profil Sayfasında "Gönderilerim" Kısmı
app.get('/api/gonderilerim', async (req, res) => {
    try {
        const { yazarId } = req.query;
        if (!yazarId) return res.json([]);

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
        if (g) {
            if (!g.begenenler.includes(yazar)) { g.begenenler.push(yazar); g.begeni++; }
            else { g.begenenler = g.begenenler.filter(x => x !== yazar); g.begeni--; }
            await g.save();
            res.json({ durum: 'basarili' });
        } else res.status(404).json({ durum: 'hata' });
    } catch (e) { res.status(500).json({ durum: 'hata' }); }
});

// Gönderi Silme
app.delete('/api/gonderi-sil/:id', async (req, res) => {
    try {
        await Gonderi.findByIdAndDelete(req.params.id);
        res.json({ durum: 'basarili' });
    } catch (e) { res.status(500).json({ durum: 'hata' }); }
});

app.delete('/api/gonderi/:gonderiId/yorum/:yorumId', async (req, res) => {
    try {
        const { gonderiId, yorumId } = req.params;
        await Gonderi.findByIdAndUpdate(gonderiId, {
            $pull: { yorumlar: { _id: yorumId } }
        });
        res.json({ durum: 'basarili' });
    } catch (e) {
        res.status(500).json({ durum: 'hata' });
    }
});

// TEKİL DOSYA YÜKLEME ROTASI (Sertifika/Proje için)
app.post('/api/dosya-yukle', upload.single('dosya'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ durum: 'hata', mesaj: 'Dosya seçilmedi' });
        res.json({ durum: 'basarili', url: req.file.path });
    } catch (e) {
        res.status(500).json({ durum: 'hata', mesaj: e.message });
    }
});

// --- KULLANICI ARAMA ---
app.get('/api/kullanici-ara', async (req, res) => {
    try {
        const q = req.query.q || "";
        let query = {};

        if (q.length > 0) {
            query = {
                $or: [
                    { adSoyad: { $regex: q, $options: 'i' } },
                    { kullaniciAdi: { $regex: q, $options: 'i' } }
                ]
            };
        }

        const users = await Kullanici.find(query).select('adSoyad kullaniciAdi resimUrl _id').limit(100);
        res.json(users);
    } catch (e) {
        console.log("Arama Hatası:", e);
        res.status(500).json({ durum: 'hata', mesaj: e.message });
    }
});

// --- TAKİP ET / TAKİBİ BIRAK ROTASI ---
app.post('/api/kullanici-takip', async (req, res) => {
    const { aktifKullaniciId, hedefKullaniciId } = req.body;

    if (aktifKullaniciId === hedefKullaniciId) {
        return res.status(400).json({ durum: 'hata', mesaj: 'Kendini takip edemezsin' });
    }

    try {
        const aktifKullanici = await Kullanici.findById(aktifKullaniciId);
        const hedefKullanici = await Kullanici.findById(hedefKullaniciId);

        if (!aktifKullanici || !hedefKullanici) {
            return res.status(404).json({ durum: 'hata', mesaj: 'Kullanıcı bulunamadı' });
        }

        if (hedefKullanici.takipciler.includes(aktifKullaniciId)) {
            // TAKİBİ BIRAK
            await hedefKullanici.updateOne({ $pull: { takipciler: aktifKullaniciId } });
            await aktifKullanici.updateOne({ $pull: { takipEdilenler: hedefKullaniciId } });
            res.json({ durum: 'basarili', islem: 'takip_birakildi', mesaj: 'Takip bırakıldı' });

        } else {
            // TAKİP ET
            await hedefKullanici.updateOne({ $push: { takipciler: aktifKullaniciId } });
            await aktifKullanici.updateOne({ $push: { takipEdilenler: hedefKullaniciId } });

            const yeniBildirim = new Bildirim({
                aliciId: hedefKullaniciId,
                gonderenId: aktifKullaniciId,
                tur: 'takip',
                mesaj: 'seni takip etmeye başladı.'
            });
            await yeniBildirim.save();

            if (hedefKullanici.fcmToken) {
                await bildirimGonder(
                    hedefKullanici.fcmToken,
                    "Yeni Takipçin Var! 🎉",
                    `${aktifKullanici.adSoyad} seni takip etmeye başladı.`,
                    { type: 'profile', id: aktifKullaniciId }
                );
            }
            res.json({ durum: 'basarili', islem: 'takip_edildi', mesaj: 'Takip edildi' });
        }

    } catch (e) {
        res.status(500).json({ durum: 'hata', mesaj: e.message });
    }
});

// --- ADMIN: HERKESE BİLDİRİM GÖNDER ---
app.post('/api/herkese-bildirim-gonder', async (req, res) => {
    const { gonderenAdminId, baslik, mesaj } = req.body;
    if (gonderenAdminId !== SUPER_ADMIN_ID) {
        return res.status(403).json({ durum: 'hata', mesaj: 'Yetkisiz işlem! Sen admin değilsin.' });
    }
    try {
        const users = await Kullanici.find({ fcmToken: { $exists: true, $ne: "" } });
        users.forEach(user => {
            bildirimGonder(user.fcmToken, baslik, mesaj);
        });
        res.json({ durum: 'basarili', mesaj: `${users.length} kişiye gönderiliyor.` });
    } catch (e) {
        res.status(500).json({ durum: 'hata', hata: e.message });
    }
});

// --- ŞİFRE SIFIRLAMA (KOD GÖNDERME) ROTASI ---
app.post('/api/sifremi-unuttum', async (req, res) => {
    try {
        const { email } = req.body;
        
        // DÜZELTME 1: 'User' yerine senin tanımladığın 'Kullanici' modelini kullanıyoruz.
        const user = await Kullanici.findOne({ email });
        
        if (!user) {
            // DÜZELTME 2: 'success' yerine 'durum' formatı kullanıyoruz (App standardı).
            return res.status(404).json({ durum: 'hata', mesaj: "Bu e-posta ile kayıtlı kullanıcı bulunamadı." });
        }

        // Rastgele 6 haneli kod üret
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

        // DÜZELTME 3: Şemanda 'resetCode' yok. Var olan 'onayKodu' alanını kullanıyoruz.
        user.onayKodu = verificationCode;
        await user.save();

        // DÜZELTME 4: 'sendEmail' fonksiyonun yoktu. Mevcut 'transporter'ı kullanıyoruz.
        await transporter.sendMail({
            from: 'Kampüsüm101 <karakus.job@outlook.com>', // Burayı kendi mailinle güncelle
            to: email,
            subject: 'Şifre Sıfırlama Kodu - Kampüsüm101',
            text: `Merhaba ${user.adSoyad},\n\nŞifreni sıfırlamak için doğrulama kodun: ${verificationCode}\n\nBu işlemi sen yapmadıysan bu maili dikkate alma.`
        });

        res.json({ durum: 'basarili', mesaj: "Doğrulama kodu e-posta adresinize gönderildi." });

    } catch (error) {
        console.error("Şifre sıfırlama hatası:", error);
        // Hata durumunda HTML değil JSON dönüyoruz ki uygulama çökmesin.
        res.status(500).json({ durum: 'hata', mesaj: "Sunucu hatası: " + error.message });
    }
});

// --- ŞİFRE YENİLEME (2. AŞAMA: KODU GİR VE DEĞİŞTİR) ---
app.post('/api/sifre-yenile', async (req, res) => {
    const { email, kod, yeniSifre } = req.body;

    try {
        // 1. Kullanıcıyı bul
        const user = await Kullanici.findOne({ email });

        if (!user) {
            return res.status(404).json({ durum: 'hata', mesaj: 'Kullanıcı bulunamadı.' });
        }

        // 2. Kodu Kontrol Et (Önceki adımda 'onayKodu'na kaydetmiştik)
        // NOT: Kodlar string olduğu için === kullanıyoruz, trim() boşlukları temizler.
        if (!user.onayKodu || user.onayKodu.trim() !== kod.trim()) {
            return res.status(400).json({ durum: 'hata', mesaj: 'Girdiğiniz kod hatalı veya süresi dolmuş!' });
        }

        // 3. Şifreyi Güncelle
        user.sifre = yeniSifre;
        
        // 4. Kodu sil (Güvenlik için, tekrar kullanılamasın)
        user.onayKodu = ""; 
        
        await user.save();

        res.json({ durum: 'basarili', mesaj: 'Şifreniz başarıyla güncellendi. Giriş yapabilirsiniz.' });

    } catch (error) {
        console.error("Şifre yenileme hatası:", error);
        res.status(500).json({ durum: 'hata', mesaj: 'Sunucu hatası: ' + error.message });
    }
});
// --- KULLANICI ENGELLEME ROTASI ---
app.post('/api/kullanici-engelle', async (req, res) => {
    const { aktifKullaniciId, hedefKullaniciId } = req.body;

    try {
        const aktifKullanici = await Kullanici.findById(aktifKullaniciId);
        
        if (!aktifKullanici) return res.status(404).json({ durum: 'hata' });

        if (aktifKullanici.engellenenler.includes(hedefKullaniciId)) {
            // Zaten engelli, engeli kaldır
            await aktifKullanici.updateOne({ $pull: { engellenenler: hedefKullaniciId } });
            res.json({ durum: 'basarili', mesaj: 'Engel kaldırıldı.' });
        } else {
            // Engelle
            await aktifKullanici.updateOne({ $push: { engellenenler: hedefKullaniciId } });
            
            // Varsa takipleşmeyi de bitir
            await aktifKullanici.updateOne({ $pull: { takipciler: hedefKullaniciId, takipEdilenler: hedefKullaniciId } });
            await Kullanici.findByIdAndUpdate(hedefKullaniciId, { 
                $pull: { takipciler: aktifKullaniciId, takipEdilenler: aktifKullaniciId } 
            });

            res.json({ durum: 'basarili', mesaj: 'Kullanıcı engellendi.' });
        }
    } catch (e) {
        res.status(500).json({ durum: 'hata', mesaj: e.message });
    }
});
// index.js -> En alta ekle
app.get('/api/engellenenler-listesi/:userId', async (req, res) => {
    try {
        const user = await Kullanici.findById(req.params.userId);
        if (!user) return res.json([]);
        
        // Engellenen ID'leri kullanarak o kullanıcıların detaylarını bul
        const engellenenKullanicilar = await Kullanici.find({
            '_id': { $in: user.engellenenler }
        }).select('adSoyad kullaniciAdi resimUrl'); // Sadece gerekli alanlar

        res.json(engellenenKullanicilar);
    } catch (e) {
        res.status(500).json({ durum: 'hata', mesaj: e.message });
    }
});
app.listen(port, () => console.log(`Sunucu ${port} portunda çalışıyor...`));