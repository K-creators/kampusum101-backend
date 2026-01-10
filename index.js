require('dotenv').config(); // BU EN ÜSTTE OLMALI
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const app = express();

// --- PORT AYARI ---
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ============================================================
// MONGODB BAĞLANTISI
// ============================================================
const MONGO_URI = "mongodb+srv://admin:kampusum123@cluster0.dzud8wf.mongodb.net/?appName=Cluster0";

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ Veritabanına (MongoDB) Bağlanıldı!"))
    .catch(err => console.error("❌ Veritabanı Hatası:", err));

// --- VERİTABANI ŞEMALARI ---
const KullaniciSchema = new mongoose.Schema({
    adSoyad: String,
    kullaniciAdi: String,
    email: String,
    sifre: String,
    bolum: { type: String, default: "Genel" },
    rol: String,
    bio: { type: String, default: "Merhaba!" },
    resimUrl: String,
    takipciler: [String],
    takipEdilenler: [String],
    createdAt: { type: Date, default: Date.now }
});
const Kullanici = mongoose.model('Kullanici', KullaniciSchema);

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
        kullaniciAdi: String,
        profilResim: String,
        icerik: String,
        tarih: String
    }]
});
const Gonderi = mongoose.model('Gonderi', GonderiSchema);

const YoklamaSchema = new mongoose.Schema({
    dersAdi: String,
    tarih: String,
    kod: String,
    konum: String
});
const Yoklama = mongoose.model('Yoklama', YoklamaSchema);

const DuyuruSchema = new mongoose.Schema({
    baslik: String,
    icerik: String,
    yayinlayan: String,
    tarih: String
});
const Duyuru = mongoose.model('Duyuru', DuyuruSchema);

// --- E-POSTA AYARLARI (BREVO) ---
const transporter = nodemailer.createTransport({
    host: "smtp-relay.brevo.com",
    port: 2525, 
    secure: false,
    auth: {
        user: process.env.EMAIL_USER, // Render'dan çekecek
        pass: process.env.EMAIL_PASS  // Render'dan çekecek
    },
    tls: {
        rejectUnauthorized: false
    }
});

// --- DOSYA YÜKLEME AYARLARI ---
const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, 'uploads/') },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname)); 
    }
});
const upload = multer({ storage: storage });
app.use('/uploads', express.static('uploads'));

// --- GEÇİCİ BELLEK ---
let onayBekleyenler = {}; 
let sifreYenilemeBekleyenler = {}; 

const SINIF_LAT = 40.5489; const SINIF_LNG = 34.9533; const MAX_MESAFE_METRE = 10000;

function mesafeHesapla(lat1, lon1, lat2, lon2) {
    const R = 6371e3; 
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ/2)*Math.sin(Δφ/2) + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)*Math.sin(Δλ/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
const tarihGetir = () => {
    const d = new Date();
    return d.toLocaleDateString('tr-TR') + ' ' + d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
};

// ================= ROTALAR =================

app.get('/', (req, res) => res.send('Kampüsüm101 Backend Çalışıyor! 🚀'));

// --- ŞİFREMİ UNUTTUM ---
app.post('/api/sifremi-unuttum', async (req, res) => {
    const { email } = req.body;
    const kullanici = await Kullanici.findOne({ email });

    if (!kullanici) {
        return res.status(404).json({ durum: 'hata', mesaj: 'Bu e-posta adresi ile kayıtlı kullanıcı bulunamadı.' });
    }

    const kod = Math.floor(100000 + Math.random() * 900000).toString();
    sifreYenilemeBekleyenler[email] = kod;

    res.json({ durum: 'basarili', mesaj: 'Doğrulama kodu e-postana gönderiliyor.' });

    transporter.sendMail({
        from: '"Kampüsüm101 Destek" <kampusum101info@gmail.com>', 
        to: email,
        subject: 'Şifre Sıfırlama Kodu',
        text: `Merhaba ${kullanici.adSoyad},\n\nŞifreni sıfırlamak için kodun: ${kod}\n\nBu işlemi sen yapmadıysan dikkate alma.`
    }).then(() => {
        console.log(`✅ Şifre Maili Gitti: ${email}`);
    }).catch((err) => {
        console.log(`⚠️ Mail Hatası: ${email}`);
        console.error(err);
    });
});

// --- ŞİFRE YENİLEME ---
app.post('/api/sifre-yenile', async (req, res) => {
    const { email, kod, yeniSifre } = req.body;

    if (sifreYenilemeBekleyenler[email] !== kod) {
        return res.status(400).json({ durum: 'hata', mesaj: 'Girdiğiniz kod hatalı!' });
    }

    const sonuc = await Kullanici.findOneAndUpdate({ email }, { sifre: yeniSifre });
    
    if (sonuc) {
        delete sifreYenilemeBekleyenler[email];
        res.json({ durum: 'basarili', mesaj: 'Şifreniz başarıyla güncellendi! Giriş yapabilirsiniz.' });
    } else {
        res.status(404).json({ durum: 'hata', mesaj: 'Kullanıcı bulunamadı.' });
    }
});

// --- KAYIT İSTEK ---
app.post('/api/kayit-istek', async (req, res) => {
    const { adSoyad, kullaniciAdi, email, sifre, bolum } = req.body;

    const emailVar = await Kullanici.findOne({ email });
    if (emailVar) return res.status(400).json({ durum: 'hata', mesaj: 'E-posta zaten kayıtlı!' });
    
    const nickVar = await Kullanici.findOne({ kullaniciAdi });
    if (nickVar) return res.status(400).json({ durum: 'hata', mesaj: 'Kullanıcı adı alınmış!' });

    let belirlenenRol = "ogrenci";
    if (email.endsWith('@ogrenci.hitit.edu.tr')) belirlenenRol = "ogrenci";
    else if (email.endsWith('@hitit.edu.tr')) belirlenenRol = "akademisyen";
    
    const dogrulamaKodu = Math.floor(100000 + Math.random() * 900000).toString();
    
    onayBekleyenler[email] = { adSoyad, kullaniciAdi, email, sifre, bolum, rol: belirlenenRol, kod: dogrulamaKodu };

    res.json({ durum: 'basarili', mesaj: 'Kod gönderildi!', tespitEdilenRol: belirlenenRol });

    transporter.sendMail({
        from: '"Kampüsüm101 Güvenlik" <kampusum101info@gmail.com>', 
        to: email, 
        subject: 'Doğrulama Kodu', 
        text: `Kodun: ${dogrulamaKodu}`
    }).then(() => {
        console.log(`✅ Kayıt Maili Gitti: ${email}`);
    }).catch((err) => {
        console.log(`⚠️ Mail Hatası: ${email}`);
        console.error(err);
    });
});

// --- KAYIT DOĞRULA ---
app.post('/api/kayit-dogrula', async (req, res) => {
    const { email, kod } = req.body;
    const bekleyen = onayBekleyenler[email];
    if (!bekleyen) return res.status(400).json({ durum: 'hata', mesaj: 'Zaman aşımı.' });
    
    if (bekleyen.kod === kod) {
        const yeniKullanici = new Kullanici({ 
            adSoyad: bekleyen.adSoyad, 
            kullaniciAdi: bekleyen.kullaniciAdi, 
            email: bekleyen.email, 
            sifre: bekleyen.sifre, 
            bolum: bekleyen.bolum || "Genel", 
            rol: bekleyen.rol
        });

        await yeniKullanici.save(); 
        delete onayBekleyenler[email];
        res.json({ durum: 'basarili', mesaj: 'Hesap oluşturuldu!' });
    } else { 
        res.status(400).json({ durum: 'hata', mesaj: 'Hatalı kod!' }); 
    }
});

// --- GİRİŞ ---
app.post('/api/giris', async (req, res) => {
    const { email, sifre } = req.body;
    const kullanici = await Kullanici.findOne({ email, sifre });
    
    if (kullanici) res.json({ durum: 'basarili', mesaj: 'Giriş başarılı', kullanici: kullanici });
    else res.status(401).json({ durum: 'hata', mesaj: 'E-posta veya şifre hatalı!' });
});

// --- DİĞER ROTALAR ---

app.get('/api/kullanici-ara', async (req, res) => { 
    const q = (req.query.q||"").toLowerCase(); 
    const sonuclar = await Kullanici.find({
        $or: [
            { adSoyad: { $regex: q, $options: 'i' } },
            { kullaniciAdi: { $regex: q, $options: 'i' } }
        ]
    });
    res.json(sonuclar);
});

app.post('/api/takip-et', async (req, res) => { 
    const { yapanId, hedefId } = req.body; 
    const yapan = await Kullanici.findById(yapanId);
    const hedef = await Kullanici.findById(hedefId);
    
    if(yapan && hedef){ 
        if(!yapan.takipEdilenler.includes(hedefId)){
            yapan.takipEdilenler.push(hedefId);
            hedef.takipciler.push(yapanId);
        } else {
            yapan.takipEdilenler = yapan.takipEdilenler.filter(id => id !== hedefId);
            hedef.takipciler = hedef.takipciler.filter(id => id !== yapanId);
        }
        await yapan.save();
        await hedef.save();
        res.json({durum:'basarili', yapanKullanici: yapan}); 
    } else res.status(404).json({durum:'hata'}); 
});

app.post('/api/kullanici-listesi', async (req, res) => { 
    const {ids} = req.body; 
    if(!ids) return res.json([]); 
    const sonuclar = await Kullanici.find({ _id: { $in: ids } });
    res.json(sonuclar); 
});

app.get('/api/kullanici/:id', async (req, res) => { 
    try {
        const k = await Kullanici.findById(req.params.id);
        if(k) res.json(k); else res.status(404).json({});
    } catch(e) { res.status(404).json({}); }
});

app.post('/api/profil-guncelle', upload.single('resim'), async (req, res) => { 
    const {id,adSoyad,kullaniciAdi,bolum,bio} = req.body; 
    if(kullaniciAdi) {
        const varMi = await Kullanici.findOne({ kullaniciAdi: kullaniciAdi, _id: { $ne: id } });
        if(varMi) return res.status(400).json({durum:'hata', mesaj: 'Kullanıcı adı dolu'});
    }
    
    const r = req.file ? req.file.path.replace(/\\/g,"/") : undefined;
    const guncelVeri = { adSoyad, kullaniciAdi, bolum, bio };
    if(r) guncelVeri.resimUrl = r;

    const yeniProfil = await Kullanici.findByIdAndUpdate(id, guncelVeri, { new: true });
    res.json({durum:'basarili', yeniProfil}); 
});

app.post('/api/yoklama', async (req, res) => { 
    const {qrKodu,lat,lng} = req.body; 
    if(!lat||!lng) return res.status(400).json({durum:'hata'}); 
    const m = mesafeHesapla(lat,lng,SINIF_LAT,SINIF_LNG); 
    if(m > MAX_MESAFE_METRE) return res.status(400).json({durum:'hata'}); 
    if(qrKodu!=="CS202" && qrKodu!=="1234") return res.status(400).json({durum:'hata'}); 
    
    await new Yoklama({ dersAdi:"Veri Yapıları", tarih:tarihGetir(), kod:qrKodu, konum:`${lat},${lng}` }).save();
    res.json({durum:'basarili', mesaj:'Yoklama alındı!'}); 
});

app.post('/api/gonderi-paylas', upload.single('resim'), async (req, res) => { 
    const {icerik,yazar,kullaniciAdi,bolum,profilResim,yazarId} = req.body; 
    const r = req.file ? req.file.path.replace(/\\/g,"/") : null; 
    
    await new Gonderi({
        yazarId, yazar, kullaniciAdi, bolum, profilResim, icerik, resimUrl:r, tarih:tarihGetir()
    }).save();
    
    res.json({durum:'basarili'}); 
});

app.get('/api/akis', async (req, res) => { 
    const gonderiler = await Gonderi.find().sort({ _id: -1 });
    res.json(gonderiler); 
});

app.delete('/api/gonderi-sil/:id', async (req, res) => { 
    await Gonderi.findByIdAndDelete(req.params.id);
    res.json({durum:'basarili'}); 
});

app.post('/api/gonderi/:id/begen', async (req, res) => { 
    const {yazar} = req.body; 
    const g = await Gonderi.findById(req.params.id); 
    if(g){ 
        if(!g.begenenler.includes(yazar)){
            g.begenenler.push(yazar);
            g.begeni += 1;
        }else{
            const i = g.begenenler.indexOf(yazar);
            g.begenenler.splice(i,1);
            g.begeni = Math.max(0, g.begeni-1);
        } 
        await g.save();
        res.json({durum:'basarili',yeniBegeni:g.begeni,begenenler:g.begenenler}); 
    } else res.status(404).json({durum:'hata'}); 
});

app.post('/api/gonderi/:id/yorum', async (req, res) => { 
    const {icerik,yazar,kullaniciAdi,profilResim} = req.body; 
    const g = await Gonderi.findById(req.params.id); 
    if(g){ 
        g.yorumlar.push({yazar,kullaniciAdi,profilResim,icerik,tarih:tarihGetir()}); 
        await g.save();
        res.json({durum:'basarili',yorumlar:g.yorumlar,yorumSayisi:g.yorumlar.length}); 
    } else res.status(404).json({durum:'hata'}); 
});

app.delete('/api/gonderi/:id/yorum/:yorumId', async (req, res) => { 
    const g = await Gonderi.findById(req.params.id);
    if(g) {
        g.yorumlar = g.yorumlar.filter(y => y._id.toString() !== req.params.yorumId);
        await g.save();
        res.json({durum:'basarili',yorumlar:g.yorumlar});
    } else res.status(404).json({durum:'hata'});
});

app.get('/api/gonderilerim', async (req, res) => { 
    const y = req.query.yazar; 
    const gonderiler = await Gonderi.find({ yazar: y }).sort({ _id: -1 });
    res.json(gonderiler); 
});

app.get('/api/duyurular', async (req, res) => { 
    const duyurular = await Duyuru.find().sort({ _id: -1 });
    res.json(duyurular); 
});

app.post('/api/duyuru-ekle', async (req, res) => { 
    const { baslik, icerik, yayinlayan } = req.body; 
    await new Duyuru({ baslik, icerik, yayinlayan, tarih: tarihGetir() }).save();
    res.json({ durum: 'basarili' }); 
});

// --- SUNUCU BAŞLAT ---
app.listen(port, () => {
    console.log(`Sunucu ${port} portunda çalışıyor...`);
});