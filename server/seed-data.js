// Demo hesaplar. SADECE geliştirme içindir; üretimde kullanmayın.
export const DEMO_SIFRE = 'demo1234';

const KOMISYONCULAR = [
  'Yılmaz Komisyon', 'Demir Hal Ticaret', 'Kaya Kardeşler', 'Çelik Sebze Meyve', 'Şahin Komisyon',
  'Yıldız Hal', 'Aydın Tarım', 'Öztürk Komisyonculuk', 'Arslan Meyve', 'Doğan Sebze',
  'Kılıç Hal Ticaret', 'Aslan Komisyon', 'Çetin Kardeşler', 'Kara Tarım Ürünleri', 'Koç Komisyon',
  'Kurt Hal', 'Özdemir Sebze', 'Polat Meyve Komisyon', 'Erdoğan Hal Ticaret', 'Güneş Komisyon',
  'Bulut Tarım', 'Akın Kardeşler', 'Taş Sebze Meyve', 'Uçar Komisyon', 'Korkmaz Hal',
];

export const DEMO_HESAPLAR = [
  { ad: 'Admin', telefon: '05000000000', rol: 'admin', durum: 'onayli', sifre: DEMO_SIFRE },
  // Son iki komisyoncu onay bekliyor (onay akışını denemek için).
  ...KOMISYONCULAR.map((ad, i) => ({
    ad, telefon: '0500000' + String(i + 1).padStart(4, '0'), rol: 'kom',
    durum: i >= KOMISYONCULAR.length - 2 ? 'bekliyor' : 'onayli', sifre: DEMO_SIFRE,
  })),
];

// Tüccarlar ve hedef toplam borç (TL). Her renk seviyesine en az bir tüccar düşer.
export const DEMO_TUCCARLAR = [
  ['Ahmet Sebze', 635_000], ['Çiftçi Market', 420_000], ['Ege Manav', 880_000],
  ['Bereket Meyve', 3_600_000], ['Lezzet Gıda', 2_150_000], ['Toros Pazarlama', 4_700_000],
  ['Anadolu Gıda', 7_500_000], ['Güney Sebze', 9_200_000],
  ['Yeşil Hal Pazarlama', 12_400_000], ['Karadeniz Meyve', 18_300_000],
  ['Marmara Gıda Dağıtım', 27_000_000], ['Trakya Sebze', 34_000_000],
  ['Akdeniz Market Zinciri', 44_500_000], ['Mega Toptan Gıda', 56_000_000],
  ['Çukurova Tarım', 63_000_000], ['İç Anadolu Hal', 77_500_000],
  ['Başkent Hal Ürünleri', 84_000_000], ['Kuzey Gıda A.Ş.', 96_000_000],
  ['Doğu Gıda Holding', 135_000_000],
];
