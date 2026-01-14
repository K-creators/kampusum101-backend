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
    
    createdAt: { type: Date, default: Date.now },
    sonKullaniciAdiDegisikligi: { type: Date, default: null }, // Tarih kontrolü için
    ozgecmis: {
        hakkinda: { type: String, default: "" },
        okul: { type: String, default: "" },
        bolum: { type: String, default: "" },
        isTecrubesi: { type: String, default: "" }, // Basit metin olarak tutalım şimdilik
        yetenekler: { type: String, default: "" },
        linkler: { type: String, default: "" } ,// LinkedIn, Github vs.
        sertifikalar: [{ 
            baslik: String, 
            dosyaUrl: String // İsteğe bağlı
        }],
        projeler: [{ 
            baslik: String, 
            dosyaUrl: String // İsteğe bağlı
        }]
    },
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
    params: { folder: 'kampusum101_uploads', allowed_formats: ['jpg', 'png', 'jpeg', 'heic','pdf'] },
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
            from: 'Kampüsüm101 <karakus.job@outlook.com>', // Brevo'da onaylı mailin
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
    host: "smtp-relay.brevo.com", // Brevo Sunucusu
    port: 2525,                   // SİHİRLİ PORT (Render bunu engellemez)
    secure: false,                // 2525 için false olmalı
    auth: {
        user: process.env.EMAIL_USER, // Render'daki Brevo maili
        pass: process.env.EMAIL_PASS  // Render'daki Brevo şifresi
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
    const { id, adSoyad, kullaniciAdi, bolum, bio, ozgecmis } = req.body;
    
    try {
        const user = await Kullanici.findById(id);
        if (!user) return res.status(404).json({ durum: 'hata', mesaj: 'Kullanıcı bulunamadı' });

        // KULLANICI ADI DEĞİŞİKLİĞİ KONTROLÜ
        if (kullaniciAdi && kullaniciAdi !== user.kullaniciAdi) {
            // 1. Format Kontrolü
            const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
            if (!usernameRegex.test(kullaniciAdi)) {
                return res.status(400).json({ durum: 'hata', mesaj: 'Geçersiz kullanıcı adı formatı!' });
            }

            // 2. Benzersizlik Kontrolü
            const varMi = await Kullanici.findOne({ kullaniciAdi });
            if (varMi) return res.status(400).json({ durum: 'hata', mesaj: 'Bu kullanıcı adı zaten alınmış.' });

            // 3. Zaman Kontrolü (7 Gün)
            const bugun = new Date();
            if (user.sonKullaniciAdiDegisikligi) {
                const gecenSure = bugun - new Date(user.sonKullaniciAdiDegisikligi);
                const yediGunMs = 7 * 24 * 60 * 60 * 1000;
                
                if (gecenSure < yediGunMs) {
                    const kalanGun = Math.ceil((yediGunMs - gecenSure) / (24 * 60 * 60 * 1000));
                    return res.status(400).json({ durum: 'hata', mesaj: `Kullanıcı adını değiştirmek için ${kalanGun} gün daha beklemelisin.` });
                }
            }
            
            // Onaylanırsa güncelle ve tarihi kaydet
            user.kullaniciAdi = kullaniciAdi;
            user.sonKullaniciAdiDegisikligi = bugun;
        }

        // Diğer Bilgiler
        if (adSoyad) user.adSoyad = adSoyad;
        if (bolum) user.bolum = bolum;
        if (bio) user.bio = bio;
        if (req.file) user.resimUrl = req.file.path;

        // CV Güncelleme (JSON string olarak gelirse parse et, obje gelirse direkt al)
        if (ozgecmis) {
            let cvData = ozgecmis;
            if (typeof ozgecmis === 'string') {
                try { cvData = JSON.parse(ozgecmis); } catch(e) {}
            }
            user.ozgecmis = { ...user.ozgecmis, ...cvData };
        }

        await user.save();
        res.json({ durum: 'basarili', yeniProfil: user });

    } catch (e) {
        console.log(e);
        res.status(500).json({ durum: 'hata', mesaj: e.message });
    }
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
// TEKİL DOSYA YÜKLEME ROTASI (Sertifika/Proje için)
app.post('/api/dosya-yukle', upload.single('dosya'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ durum: 'hata', mesaj: 'Dosya seçilmedi' });
        res.json({ durum: 'basarili', url: req.file.path });
    } catch (e) {
        res.status(500).json({ durum: 'hata', mesaj: e.message });
    }
});
app.listen(port, () => console.log(`Sunucu ${port} portunda!`));