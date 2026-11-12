// Yerel geliştirme: demo hesaplarını/verilerini yükler ve demo modunu açar.
// Canlıda demo modu admin panelinden açılıp kapatılır (Yayın Ayarları > Demo modu).
import { init, get, demoYukle, ayarGetir, ayarKaydet } from './db.js';

await init();
await demoYukle();
await ayarKaydet({ ...(await ayarGetir()), demo_modu: true });
const sayi = await get('SELECT (SELECT COUNT(*) FROM halder_users WHERE demo=TRUE) u, (SELECT COUNT(*) FROM halder_alacak WHERE demo=TRUE) a');
console.log(`Demo verisi hazır: ${sayi.u} demo kullanıcı, ${sayi.a} demo alacak; demo modu açık. Hesaplar için server/seed-data.js dosyasına bakın.`);
process.exit(0);
