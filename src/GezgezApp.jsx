import { useState, useMemo, useEffect } from "react";

function toKey(d) {
  if (!d) return "";
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function fromKey(s) {
  if (!s) return null;
  const [y,m,d] = s.split("-").map(Number);
  return new Date(y, m-1, d);
}
function sameDay(a,b) { return a && b && toKey(a)===toKey(b); }
function fmtShort(s) {
  if (!s) return "—";
  const d = fromKey(s);
  if (!d) return "—";
  return `${d.getDate()} ${MONTHS_TR[d.getMonth()]}`;
}
async function storageGet(key) {
  try { if (!window.storage) return null; const r = await window.storage.get(key); return r?.value ?? null; } catch(e) { return null; }
}
async function storageSet(key, val) {
  try { if (!window.storage) return; await window.storage.set(key, val); } catch(e) {}
}

const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const CLAUDE_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY;

async function callGemini(prompt) {
  const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent";
  const sys = "Sen profesyonel bir seyahat danışmanısın. Yanıtını SADECE geçerli bir JSON formatında ver. Başka hiçbir açıklama, selamlama veya markdown kodu (```json vb.) kullanma.";
  const fullPrompt = `${sys}

Kullanıcı isteği:
${prompt}`;
  const r = await fetch(`${BASE_URL}?key=${GEMINI_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
      generationConfig: { responseMimeType: "application/json" }
    })
  });
  if (!r.ok) {
    const errText = await r.text();
    throw new Error(`Google API Hatası (${r.status}): ${errText}`);
  }
  const d = await r.json();
  const raw = d.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error("Gemini'den boş yanıt geldi.");
  const clean = raw.replace(/```json/g, '').replace(/```/g, '').trim();
  return JSON.parse(clean);
}

async function callClaude(prompt) {
  const sys = "Sen profesyonel bir seyahat danışmanısın. Yanıtını SADECE geçerli bir JSON formatında ver. Başka hiçbir açıklama veya markdown kullanma.";
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": CLAUDE_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      system: sys,
      messages: [{ role: "user", content: prompt }]
    })
  });
  if (!r.ok) throw new Error("Claude HTTP " + r.status);
  const d = await r.json();
  const raw = d.content?.[0]?.text;
  if (!raw) throw new Error("Claude boş yanıt döndü.");
  const clean = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(clean);
}

async function askGemini(prompt) {
  return await callGemini(prompt);
}

function buildPrompt(city, from, to, mod, adults, children, childAges, note, isYurtici=false) {
  const nights = Math.max(1, Math.round((fromKey(to) - fromKey(from)) / 86400000));
  const kisi = `${adults} yetişkin${children > 0 ? `, ${children} çocuk (${childAges.map(a => a===0?"bebek":a+"y").join(",")})` : ""}`;
  const ekIstek = note.trim() ? ` ${note.trim()}` : "";
  const guzergah = isYurtici ? `Ankara-${city.name}` : `Ankara-${city.name}`;
  const ucusField = isYurtici
    ? `"ulasim":{"info":"otobüs/uçak seçeneği ve TL fiyat","tip":"tavsiye"},`
    : `"flight":{"info":"havayolu ve TL fiyat","tip":"tavsiye"},`;
  const ucusKey = isYurtici ? "ulasim" : "flight";

  return `Gezgez seyahat asistanısın. Türkçe, kısa ve öz yaz.
${guzergah}, ${mod}, ${from}-${to}, ${nights} gece, ${kisi}.${ekIstek}

SADECE JSON döndür:
{
"title":"${city.name} ${mod} turu",
"subtitle":"kısa açıklama",
${ucusField}
"weather":"hava ve kıyafet önerisi",
"hotels":[{"name":"otel","area":"semt","price":"TL/gece","note":"özellik"},{"name":"otel2","area":"semt","price":"TL/gece","note":"özellik"}],
"days":[{"day":1,"title":"başlık","slots":[{"time":"Sabah","place":"yer","desc":"açıklama","food":"yemek"},{"time":"Öğle","place":"yer","desc":"açıklama","food":""},{"time":"Akşam","place":"yer","desc":"açıklama","food":"yemek"}]}],
"tastes":["lezzet 1","lezzet 2","lezzet 3"],
"budget":{"${isYurtici?"ulasim":"flight"}":"TL","hotel":"TL","food":"TL","activities":"TL","total_per_person":"TL","total_group":"TL"},
"tips":["tavsiye 1","tavsiye 2"]
}
days dizisinde ${nights} gün olsun. Her alan max 60 karakter.
Eğer mod "Yerel Gurme" ise; popüler ve turistik restoranlar yerine yerel halkın müdavimi olduğu esnaf lokantaları, tabelasız aile işletmeleri, geleneksel yöntemlerle (fermentasyon, artisan üretim, tandır, taş fırın) üretim yapan noktaları öner. Hikayesi olan yemekleri, sadece belirli saatlerde çıkan sokak lezzetlerini ve yerel içecekleri (şalgam, boza, ayran, geleneksel şuruplar) ön plana çıkar. TripAdvisor listelerinden uzak dur.
Bütçe tahminlerinde güncel Türkiye enflasyonunu, TL/EUR ve TL/USD kurunu ve yüksek sezonu (Haziran-Ağustos) dikkate al. Fiyatları her zaman üst sınırdan (kötümser/pessimistic) hesapla, kullanıcı sürprizle karşılaşmasın. Otel fiyatlarında "Booking.com'da şu an görünen orta-üst segment fiyat" gibi düşün.`;
}

const MONTHS_TR = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"];
const DAYS_TR = ["Pt","Sa","Ça","Pe","Cu","Ct","Pz"];

const CITIES = [
  {id:"tokyo",    name:"Tokyo",    flag:"🇯🇵",sky:"TYO",booking:"tokyo"},
  {id:"paris",    name:"Paris",    flag:"🇫🇷",sky:"PAR",booking:"paris"},
  {id:"london",   name:"Londra",   flag:"🇬🇧",sky:"LON",booking:"london"},
  {id:"dubai",    name:"Dubai",    flag:"🇦🇪",sky:"DXB",booking:"dubai"},
  {id:"rome",     name:"Roma",     flag:"🇮🇹",sky:"ROM",booking:"rome"},
  {id:"barcelona",name:"Barselona",flag:"🇪🇸",sky:"BCN",booking:"barcelona"},
  {id:"prague",   name:"Prag",     flag:"🇨🇿",sky:"PRG",booking:"prague"},
  {id:"phuket",   name:"Phuket",   flag:"🇹🇭",sky:"HKT",booking:"phuket"},
  {id:"lisbon",   name:"Lizbon",   flag:"🇵🇹",sky:"LIS",booking:"lisbon"},
  {id:"doha",     name:"Katar",    flag:"🇶🇦",sky:"DOH",booking:"doha"},
  {id:"madrid",   name:"Madrid",   flag:"🇪🇸",sky:"MAD",booking:"madrid"},
  {id:"amsterdam",name:"Amsterdam",flag:"🇳🇱",sky:"AMS",booking:"amsterdam"},
];

const FAMILY_HOTELS = {
  tokyo:    [{name:"Cerulean Tower Tokyu Hotel",area:"Shibuya",note:"Çocuk menüsü, şehir manzarası"},{name:"Hotel Gracery Shinjuku",area:"Shinjuku",note:"Godzilla temalı kat, aile odaları"}],
  paris:    [{name:"Hôtel du Louvre",area:"1. Arr.",note:"Louvre'a yürüme mesafesi"},{name:"citizenM Paris Gare de Lyon",area:"12. Arr.",note:"Geniş odalar, uygun fiyat"}],
  london:   [{name:"Great Northern Hotel",area:"King's Cross",note:"Tren bağlantısı mükemmel"},{name:"Park Plaza Westminster Bridge",area:"South Bank",note:"Nehir manzarası, aile paketi"}],
  dubai:    [{name:"Atlantis The Palm",area:"Palm Jumeirah",note:"Aquaventure su parkı dahil"},{name:"Jumeirah Beach Hotel",area:"Jumeirah",note:"Plaj erişimi, çocuk kulübü"}],
  rome:     [{name:"Hotel Artemide",area:"Via Nazionale",note:"Merkezi konum, kahvaltı dahil"},{name:"Mediterraneo Hotel",area:"Termini yakını",note:"Geniş aile odaları"}],
  barcelona:[{name:"Hotel Arts Barcelona",area:"Barceloneta",note:"Plaja sıfır, havuz"},{name:"NH Collection Constanza",area:"Eixample",note:"Şehir merkezi"}],
  prague:   [{name:"Hotel Josef",area:"Staré Město",note:"Eski şehir kalbinde"},{name:"Vienna House Easy Wenceslas",area:"Václavské náměstí",note:"Uygun fiyat, metro yakını"}],
  phuket:   [{name:"Angsana Laguna Phuket",area:"Laguna",note:"Lagoon havuz, çocuk aktiviteleri"},{name:"Centara Grand Beach Resort",area:"Karon Beach",note:"Su parkı, aile suite'leri"}],
  lisbon:   [{name:"Bairro Alto Hotel",area:"Chiado",note:"Tarihi bina, şehir manzarası"},{name:"Real Palácio Hotel",area:"Marquês de Pombal",note:"Geniş odalar"}],
  doha:     [{name:"Banana Island Resort",area:"Banana Island",note:"Özel ada, su sporları"},{name:"Hilton Doha The Pearl",area:"The Pearl",note:"Marina manzarası"}],
  madrid:   [{name:"Only YOU Hotel Atocha",area:"Atocha",note:"Tren istasyonu yanı, modern"},{name:"VP Plaza España Design",area:"Plaza España",note:"Rooftop havuz"}],
  amsterdam:[{name:"Mercure Amsterdam City",area:"Waterlooplein",note:"Kanal manzarası"},{name:"ibis Styles Amsterdam CS",area:"Centraal Station",note:"İstasyon yanı, uygun fiyat"}],
};

const CITIES_TR = [
  {id:"istanbul",  name:"İstanbul",   flag:"🕌",sky:"IST",booking:"istanbul"},
  {id:"izmir",     name:"İzmir",      flag:"🌊",sky:"ADB",booking:"izmir"},
  {id:"antalya",   name:"Antalya",    flag:"🏖️",sky:"AYT",booking:"antalya"},
  {id:"cappadocia",name:"Kapadokya",  flag:"🎈",sky:"NAV",booking:"cappadocia"},
  {id:"bodrum",    name:"Bodrum",     flag:"⛵",sky:"BJV",booking:"bodrum"},
  {id:"mugla",     name:"Muğla",      flag:"🌿",sky:"DLM",booking:"mugla"},
  {id:"gaziantep", name:"Gaziantep",  flag:"🍽️",sky:"GZT",booking:"gaziantep"},
  {id:"sanliurfa", name:"Şanlıurfa",  flag:"🏛️",sky:"GNY",booking:"sanliurfa"},
  {id:"mardin",    name:"Mardin",     flag:"🪨",sky:"MQM",booking:"mardin"},
  {id:"safranbolu",name:"Safranbolu", flag:"🏘️",sky:"KZO",booking:"safranbolu"},
  {id:"ankara",    name:"Ankara",     flag:"🏛️",sky:"ESB",booking:"ankara"},
  {id:"bursa",     name:"Bursa",      flag:"🌸",sky:"YEI",booking:"bursa"},
  {id:"trabzon",   name:"Trabzon",    flag:"🌊",sky:"TZX",booking:"trabzon"},
  {id:"aydin",     name:"Aydın",      flag:"🏺",sky:"ADB",booking:"aydin"},
  {id:"balikesir", name:"Balıkesir",  flag:"🫒",sky:"BZI",booking:"balikesir"},
];

const MODS = [
  {id:"aile",       icon:"👨‍👩‍👧",label:"Aile",        desc:"Çocuk dostu, güvenli, erken programlar"},
  {id:"gurme",      icon:"🍽️",   label:"Gurme",       desc:"Pazar turları, yerel lezzetler"},
  {id:"macera",     icon:"🧗",   label:"Macera",      desc:"Doğa, su sporları, keşif"},
  {id:"butce",      icon:"💸",   label:"Bütçe Dostu", desc:"Ekonomik konaklama, ücretsiz müzeler"},
  {id:"local_foodie",icon:"🍲",  label:"Yerel Gurme", desc:"Turist tuzaklarından uzak, gerçek yerel lezzetler"},
];

const TAG_COLORS = {
  "Sahil":     {bg:"#e6f1fb",color:"#185fa5",border:"#b5d4f4"},
  "Gastronomi":{bg:"#faeeda",color:"#854f0b",border:"#fac775"},
  "Tarih":     {bg:"#eeedfe",color:"#534ab7",border:"#cecbf6"},
  "Şehir":     {bg:"#f1efe8",color:"#5f5e5a",border:"#d3d1c7"},
  "Göl":       {bg:"#e1f5ee",color:"#0f6e56",border:"#9fe1cb"},
  "Eğlence":   {bg:"#fbeaf0",color:"#993556",border:"#f4c0d1"},
};

const TOURS = {
  ispanya:{label:"İspanya",flag:"🇪🇸",tours:[{
    id:"cadiz",title:"Cádiz — 3 Günlük Ada Günlüğü",subtitle:"Sevilla üzerinden Endülüs sahili",
    tags:["Sahil","Tarih","Gastronomi"],duration:"3 gün",budget:"~55.000 TL",cover:"🏖️",
    days:[
      {day:1,title:"Gümüş Fincan'da İlk Adımlar",slots:[
        {time:"Sabah",place:"Cádiz Katedrali",desc:"Altın kubbeli katedral ve Torre del Reloj.",food:{name:"Pan con Tomate",note:"pazar meyveleriyle"}},
        {time:"Öğle",place:"Torre Tavira",desc:"Camera Obscura ile şehri 360° izle."},
        {time:"Öğleden sonra",place:"El Pópulo Mahallesi",desc:"Dar labirent sokaklar, Roma Tiyatrosu."},
        {time:"Akşam",place:"Barrio de la Viña",desc:"Casa Manteca'da tapas.",food:{name:"Payoyo + Jamón Ibérico",note:""}},
      ]},
      {day:2,title:"James Bond Plajı ve Gün Batımı",slots:[
        {time:"Gündüz",place:"Playa de La Caleta",desc:"İki kale arası efsanevi plaj.",food:{name:"Pescaíto Frito",note:"kızarmış balık külahı"}},
        {time:"Akşamüstü",place:"Parque Genovés",desc:"Tropik ağaçlar, serin yürüyüş.",food:{name:"Tortillitas de Camarones",note:"çıtır karides krep"}},
        {time:"Gün Batımı",place:"Castillo de Santa Catalina",desc:"Okyanus ufkunda gün batımı."},
      ]},
      {day:3,title:"Uzun Sahiller ve Gurme Keşifler",slots:[
        {time:"Gündüz",place:"Playa de la Victoria",desc:"Kilometrelerce kumsal."},
        {time:"Öğleden sonra",place:"Mercado Central",desc:"Yerel peynir ve şarap.",food:{name:"Queso Payoyo",note:""}},
        {time:"Akşam",place:"Veda Yemeği",desc:"Son Endülüs sofrası.",food:{name:"Almadraba Orkinos + Sherry",note:"tuzlu ferah Cádiz şarabı"}},
      ]},
    ]
  }]},
  italya:{label:"İtalya",flag:"🇮🇹",tours:[{
    id:"milan",title:"Milan + Como Gölü + Gardaland",subtitle:"Kuzey İtalya klasiği",
    tags:["Şehir","Göl","Eğlence"],duration:"5 gün",budget:"~81.000 TL",cover:"🏔️",
    days:[
      {day:1,title:"Milan — Moda & Mimari",slots:[
        {time:"Sabah",place:"Duomo di Milano",desc:"Gotik katedral ve çatı terası."},
        {time:"Öğle",place:"Galleria Vittorio Emanuele II",desc:"Dünyanın en güzel pasajı.",food:{name:"Risotto alla Milanese",note:"safranla sararmış"}},
        {time:"Akşam",place:"Navigli Kanalları",desc:"Aperitivo saati.",food:{name:"Aperol Spritz + cicchetti",note:""}},
      ]},
      {day:2,title:"Como Gölü — Sular Üzerinde",slots:[
        {time:"Sabah",place:"Como şehri",desc:"Trenle 40 dakika, göl yürüyüşü."},
        {time:"Öğle",place:"Bellagio",desc:"Göllerin İncisi.",food:{name:"Missoltino",note:"göl balığı"}},
        {time:"Akşam",place:"La Pergola",desc:"Göl manzaralı akşam yemeği.",food:{name:"Polenta + Pesce Persico",note:""}},
      ]},
      {day:3,title:"Gardaland — Eğlence Günü",slots:[
        {time:"Tüm gün",place:"Gardaland",desc:"İtalya'nın en büyük tema parkı.",food:{name:"Park içi pizza",note:"😄"}},
      ]},
    ]
  }]},
};

const CSS = `
@keyframes sway{0%,100%{transform:rotate(-2deg)}50%{transform:rotate(2deg)}}
@keyframes spin{to{transform:rotate(360deg)}}
.gg-card{border:0.5px solid var(--color-border-tertiary);border-radius:12px;cursor:pointer;background:var(--color-background-primary);transition:transform .15s,box-shadow .15s}
.gg-card:hover{transform:translateY(-2px);box-shadow:0 4px 16px rgba(0,80,160,0.1)}
.cal-day{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;cursor:pointer;user-select:none}
.cal-day:hover:not(.om):not(.pp){background:#dbeeff}
.ir{background:#dbeeff!important;border-radius:0!important}
.rs{background:#378add!important;color:white!important;border-radius:50% 0 0 50%!important}
.re{background:#378add!important;color:white!important;border-radius:0 50% 50% 0!important}
.ss{background:#378add!important;color:white!important;border-radius:50%!important}
.td{font-weight:700;color:#378add}
.om{color:#ccc;cursor:default;pointer-events:none}
.pp{opacity:0.3;cursor:default;pointer-events:none}
`;

function TravelBg() {
  return(
    <svg viewBox="0 0 800 340" xmlns="http://www.w3.org/2000/svg" style={{position:"absolute",inset:0,width:"100%",height:"100%",display:"block"}} preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="gg-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#87CEEB"/><stop offset="60%" stopColor="#B8E4F9"/><stop offset="100%" stopColor="#D4F1FF"/></linearGradient>
        <linearGradient id="gg-sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1E90FF" stopOpacity="0.85"/><stop offset="100%" stopColor="#006994" stopOpacity="0.9"/></linearGradient>
        <linearGradient id="gg-sand" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#F5DEB3"/><stop offset="100%" stopColor="#DEB887"/></linearGradient>
        <linearGradient id="gg-m1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8FA8C8"/><stop offset="100%" stopColor="#6080A0"/></linearGradient>
        <linearGradient id="gg-m2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#A8C4D8"/><stop offset="100%" stopColor="#7898B4"/></linearGradient>
        <linearGradient id="gg-sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FFE566"/><stop offset="100%" stopColor="#FFB800"/></linearGradient>
      </defs>
      <rect width="800" height="340" fill="url(#gg-sky)"/>
      <circle cx="660" cy="68" r="38" fill="url(#gg-sun)" opacity="0.92"/>
      <circle cx="660" cy="68" r="50" fill="#FFE566" opacity="0.15"/>
      <g opacity="0.8"><ellipse cx="120" cy="55" rx="55" ry="22" fill="white"/><ellipse cx="155" cy="44" rx="38" ry="18" fill="white"/><ellipse cx="85" cy="50" rx="30" ry="15" fill="white"/></g>
      <g opacity="0.7"><ellipse cx="350" cy="38" rx="42" ry="16" fill="white"/><ellipse cx="378" cy="30" rx="28" ry="13" fill="white"/><ellipse cx="322" cy="34" rx="24" ry="12" fill="white"/></g>
      <g opacity="0.6"><ellipse cx="540" cy="30" rx="34" ry="13" fill="white"/><ellipse cx="562" cy="22" rx="22" ry="10" fill="white"/></g>
      <polygon points="0,220 80,120 160,220" fill="url(#gg-m2)" opacity="0.6"/>
      <polygon points="60,220 160,100 260,220" fill="url(#gg-m1)" opacity="0.7"/>
      <polygon points="180,220 270,110 360,220" fill="url(#gg-m2)" opacity="0.65"/>
      <polygon points="300,220 390,130 480,220" fill="url(#gg-m1)" opacity="0.6"/>
      <polygon points="160,100 180,130 140,130" fill="white" opacity="0.7"/>
      <polygon points="270,110 288,138 252,138" fill="white" opacity="0.65"/>
      <path d="M0,220 Q200,210 400,222 Q600,234 800,218 L800,340 L0,340 Z" fill="url(#gg-sea)"/>
      <path d="M50,240 Q100,235 150,240" stroke="white" strokeWidth="1.5" fill="none" opacity="0.3"/>
      <path d="M200,252 Q260,246 320,252" stroke="white" strokeWidth="1.5" fill="none" opacity="0.25"/>
      <path d="M0,270 Q200,258 400,265 Q600,272 800,260 L800,340 L0,340 Z" fill="url(#gg-sand)"/>
      <g><polygon points="420,195 420,235 460,235" fill="white" opacity="0.9"/><polygon points="420,200 420,235 385,235" fill="#F0F8FF" opacity="0.8"/><rect x="408" y="235" width="36" height="8" rx="4" fill="#8B6914" opacity="0.85"/></g>
      <g style={{animation:"sway 4s ease-in-out infinite",transformOrigin:"50px 340px"}}>
        <rect x="46" y="240" width="8" height="90" rx="4" fill="#8B5E3C"/>
        <ellipse cx="50" cy="238" rx="38" ry="12" fill="#3A8C3A" transform="rotate(-20,50,238)"/>
        <ellipse cx="50" cy="238" rx="38" ry="12" fill="#2E7D2E" transform="rotate(15,50,238)"/>
        <ellipse cx="50" cy="238" rx="34" ry="11" fill="#4CAF50" transform="rotate(-50,50,238)"/>
        <circle cx="42" cy="244" r="5" fill="#8B5E3C"/>
      </g>
      <g style={{animation:"sway 5s 1s ease-in-out infinite",transformOrigin:"740px 340px"}}>
        <rect x="736" y="230" width="8" height="100" rx="4" fill="#8B5E3C"/>
        <ellipse cx="740" cy="228" rx="42" ry="13" fill="#3A8C3A" transform="rotate(-15,740,228)"/>
        <ellipse cx="740" cy="228" rx="42" ry="13" fill="#2E7D2E" transform="rotate(20,740,228)"/>
        <ellipse cx="740" cy="228" rx="36" ry="12" fill="#4CAF50" transform="rotate(-55,740,228)"/>
        <circle cx="733" cy="234" r="5" fill="#8B5E3C"/>
      </g>
      <g><line x1="580" y1="265" x2="590" y2="310" stroke="#8B5E3C" strokeWidth="3"/><path d="M548,265 Q580,240 612,265 Z" fill="#E53935" opacity="0.9"/><path d="M548,265 Q564,252 580,265 Z" fill="#FFEB3B" opacity="0.9"/><path d="M580,265 Q596,252 612,265 Z" fill="#E53935" opacity="0.9"/></g>
      <rect width="800" height="340" fill="white" opacity="0.22"/>
    </svg>
  );
}

function DateRangePicker({from,to,onChange}) {
  const today = useMemo(()=>{ const d=new Date(); d.setHours(0,0,0,0); return d; },[]);
  const [vy,setVy] = useState(today.getFullYear());
  const [vm,setVm] = useState(today.getMonth());
  const [hover,setHover] = useState(null);
  const [step,setStep] = useState(from?(to?"done":"end"):"start");
  const startD=fromKey(from), endD=fromKey(to);
  const days = useMemo(()=>{
    const first=new Date(vy,vm,1), dow=(first.getDay()+6)%7, arr=[];
    for(let i=0;i<dow;i++) arr.push({date:new Date(vy,vm,1-(dow-i)),cur:false});
    const dim=new Date(vy,vm+1,0).getDate();
    for(let i=1;i<=dim;i++) arr.push({date:new Date(vy,vm,i),cur:true});
    while(arr.length%7!==0){const l=arr[arr.length-1].date;arr.push({date:new Date(l.getFullYear(),l.getMonth(),l.getDate()+1),cur:false});}
    return arr;
  },[vy,vm]);
  const prevM=()=>{if(vm===0){setVy(y=>y-1);setVm(11);}else setVm(m=>m-1);};
  const nextM=()=>{if(vm===11){setVy(y=>y+1);setVm(0);}else setVm(m=>m+1);};
  const handleClick=(d)=>{
    if(step==="start"||step==="done"){ onChange(toKey(d),""); setStep("end"); }
    else { if(startD&&d<startD){ onChange(toKey(d),""); setStep("end"); } else { onChange(from,toKey(d)); setStep("done"); } }
  };
  const getCls=(cell)=>{
    if(!cell.cur) return "cal-day om";
    const d=cell.date, past=d<today, isStart=startD&&sameDay(d,startD), isEnd=endD&&sameDay(d,endD);
    const effEnd=endD||(hover&&step==="end"?hover:null);
    const inRange=startD&&effEnd&&d>startD&&d<effEnd;
    let cls="cal-day";
    if(past) return cls+" pp";
    if(sameDay(d,today)&&!isStart&&!isEnd) cls+=" td";
    if(isStart&&isEnd) return cls+" ss";
    if(isStart&&effEnd) return cls+" rs";
    if(isEnd) return cls+" re";
    if(inRange) return cls+" ir";
    return cls;
  };
  const nights=from&&to?Math.round((fromKey(to)-fromKey(from))/86400000):0;
  return(
    <div style={{background:"var(--color-background-primary)",border:"0.5px solid var(--color-border-secondary)",borderRadius:12,overflow:"hidden"}}>
      <div style={{display:"flex",background:"#e6f1fb",borderBottom:"0.5px solid #b5d4f4"}}>
        <div onClick={()=>setStep("start")} style={{flex:1,padding:"10px 14px",cursor:"pointer",borderRight:"0.5px solid #b5d4f4",background:step==="start"?"#c8dff7":"transparent"}}>
          <p style={{margin:"0 0 1px",fontSize:10,color:"#185fa5",textTransform:"uppercase",letterSpacing:"0.07em",fontWeight:600}}>Gidiş</p>
          <p style={{margin:0,fontSize:14,fontWeight:500,color:"#1a3a5c"}}>{from?fmtShort(from):"Seç"}</p>
        </div>
        <div onClick={()=>from&&setStep("end")} style={{flex:1,padding:"10px 14px",cursor:from?"pointer":"default",background:step==="end"?"#c8dff7":"transparent"}}>
          <p style={{margin:"0 0 1px",fontSize:10,color:"#185fa5",textTransform:"uppercase",letterSpacing:"0.07em",fontWeight:600}}>Dönüş</p>
          <p style={{margin:0,fontSize:14,fontWeight:500,color:"#1a3a5c"}}>{to?fmtShort(to):"Seç"}</p>
        </div>
        {nights>0&&<div style={{padding:"10px 12px",display:"flex",alignItems:"center"}}><span style={{fontSize:12,color:"#185fa5",fontWeight:500,whiteSpace:"nowrap"}}>{nights} gece</span></div>}
      </div>
      <div style={{padding:"5px 14px",background:"#f0f7ff",borderBottom:"0.5px solid #dbeeff"}}>
        <p style={{margin:0,fontSize:11,color:"#378add"}}>{step==="start"?"Gidiş tarihine tıkla":step==="end"?"Dönüş tarihine tıkla":"✓ Tarih seçildi"}</p>
      </div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px"}}>
        <button onClick={prevM} style={{background:"none",border:"0.5px solid var(--color-border-tertiary)",borderRadius:6,width:28,height:28,cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center"}}>‹</button>
        <p style={{margin:0,fontSize:14,fontWeight:500}}>{MONTHS_TR[vm]} {vy}</p>
        <button onClick={nextM} style={{background:"none",border:"0.5px solid var(--color-border-tertiary)",borderRadius:6,width:28,height:28,cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center"}}>›</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",padding:"0 8px"}}>
        {DAYS_TR.map(d=><div key={d} style={{textAlign:"center",fontSize:11,color:"var(--color-text-tertiary)",fontWeight:600,padding:"2px 0 6px"}}>{d}</div>)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,34px)",justifyContent:"space-around",padding:"0 8px 10px",gap:"2px 0"}}>
        {days.map((cell,i)=>(
          <div key={i} className={getCls(cell)} onClick={()=>cell.cur&&handleClick(cell.date)} onMouseEnter={()=>step==="end"&&setHover(cell.cur?cell.date:null)} onMouseLeave={()=>setHover(null)}>
            {cell.date.getDate()}
          </div>
        ))}
      </div>
    </div>
  );
}

function Tag({children}) {
  const s=TAG_COLORS[children]||{bg:"#f1efe8",color:"#5f5e5a",border:"#d3d1c7"};
  return <span style={{display:"inline-block",padding:"3px 9px",borderRadius:20,fontSize:11,background:s.bg,color:s.color,border:`0.5px solid ${s.border}`,fontWeight:500}}>{children}</span>;
}
function BackBtn({onClick}) {
  return <button onClick={onClick} style={{padding:"7px 14px",border:"0.5px solid rgba(255,255,255,0.7)",borderRadius:8,background:"rgba(255,255,255,0.85)",color:"#333",cursor:"pointer",fontSize:13,marginBottom:18}}>← Geri</button>;
}
function BgHeader({children,height=120}) {
  return(
    <div style={{position:"relative",height,overflow:"hidden"}}>
      <TravelBg/>
      <div style={{position:"relative",zIndex:1,padding:"1.25rem 1.75rem",height:"100%",boxSizing:"border-box"}}>{children}</div>
    </div>
  );
}
function SLabel({children}) {
  return <p style={{fontSize:11,fontWeight:600,color:"var(--color-text-tertiary)",textTransform:"uppercase",letterSpacing:"0.07em",margin:"0 0 10px"}}>{children}</p>;
}
function Counter({label,sub,value,min,max,onChange}) {
  return(
    <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 14px",border:"0.5px solid var(--color-border-tertiary)",borderRadius:10,background:"var(--color-background-primary)"}}>
      <div>
        <p style={{margin:0,fontSize:14,fontWeight:500}}>{label}</p>
        {sub&&<p style={{margin:0,fontSize:11,color:"var(--color-text-tertiary)"}}>{sub}</p>}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <button onClick={()=>onChange(Math.max(min,value-1))} disabled={value<=min} style={{width:30,height:30,borderRadius:"50%",border:"0.5px solid var(--color-border-secondary)",background:"var(--color-background-secondary)",cursor:value<=min?"not-allowed":"pointer",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center",opacity:value<=min?0.35:1}}>−</button>
        <span style={{fontSize:16,fontWeight:600,minWidth:18,textAlign:"center"}}>{value}</span>
        <button onClick={()=>onChange(Math.min(max,value+1))} disabled={value>=max} style={{width:30,height:30,borderRadius:"50%",border:"0.5px solid var(--color-border-secondary)",background:"var(--color-background-secondary)",cursor:value>=max?"not-allowed":"pointer",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center",opacity:value>=max?0.35:1}}>+</button>
      </div>
    </div>
  );
}

function ResultView({city,from,to,mod,plan,onReset}) {
  const [activeDay,setActiveDay] = useState(0);
  const bUrl=`https://www.booking.com/searchresults.tr.html?ss=${encodeURIComponent(city?.booking||"")}&checkin=${from}&checkout=${to}`;
  const sUrl=`https://www.skyscanner.com.tr/transport/flights/ank/${city?.sky||""}/`;
  const fhInx = mod==="aile" ? FAMILY_HOTELS[city?.id] : null;

  const Section=({icon,title,children})=>(
    <div style={{marginBottom:18,padding:"14px 16px",background:"var(--color-background-secondary)",borderRadius:12,border:"0.5px solid var(--color-border-tertiary)"}}>
      <p style={{margin:"0 0 10px",fontSize:13,fontWeight:600}}>{icon} {title}</p>
      {children}
    </div>
  );

  return(
    <div>
      <div style={{position:"relative",height:120,overflow:"hidden"}}>
        <TravelBg/>
        <div style={{position:"relative",zIndex:1,padding:"1.25rem 1.75rem",display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:32}}>{city?.flag}</span>
            <div>
              <p style={{margin:0,fontSize:17,fontWeight:600,color:"#1a3a5c",textShadow:"0 1px 3px rgba(255,255,255,0.8)"}}>{plan.title||city?.name}</p>
              <p style={{margin:0,fontSize:12,color:"#2a5080",fontWeight:500}}>{fmtShort(from)} → {fmtShort(to)}</p>
              {plan.subtitle&&<p style={{margin:"2px 0 0",fontSize:11,color:"#3a6090"}}>{plan.subtitle}</p>}
            </div>
          </div>
          <button onClick={onReset} style={{padding:"6px 12px",border:"0.5px solid rgba(255,255,255,0.7)",borderRadius:8,background:"rgba(255,255,255,0.85)",color:"#333",cursor:"pointer",fontSize:12,flexShrink:0}}>Yeniden planla</button>
        </div>
      </div>

      <div style={{padding:"1.25rem 1.25rem",background:"var(--color-background-primary)"}}>
        <div style={{display:"flex",gap:8,marginBottom:16}}>
          <a href={sUrl} target="_blank" rel="noreferrer" style={{flex:1,display:"block",padding:"10px",border:"0.5px solid #b5d4f4",borderRadius:8,background:"#e6f1fb",color:"#185fa5",textAlign:"center",fontSize:13,fontWeight:500,textDecoration:"none"}}>✈️ Skyscanner</a>
          <a href={bUrl} target="_blank" rel="noreferrer" style={{flex:1,display:"block",padding:"10px",border:"0.5px solid #9fe1cb",borderRadius:8,background:"#e1f5ee",color:"#0f6e56",textAlign:"center",fontSize:13,fontWeight:500,textDecoration:"none"}}>🏨 Booking</a>
        </div>

        {plan.budget&&(
          <Section icon="💰" title="Bütçe Özeti">
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {[["✈️ Uçak",plan.budget.flight],["🏨 Konaklama",plan.budget.hotel],["🍽️ Yeme",plan.budget.food],["🎭 Aktivite",plan.budget.activities]].map(([k,v])=>v?(
                <div key={k} style={{background:"var(--color-background-primary)",borderRadius:8,padding:"8px 10px",border:"0.5px solid var(--color-border-tertiary)"}}>
                  <p style={{margin:"0 0 2px",fontSize:11,color:"var(--color-text-tertiary)"}}>{k}</p>
                  <p style={{margin:0,fontSize:12,fontWeight:500}}>{v}</p>
                </div>
              ):null)}
            </div>
            {plan.budget.total_per_person&&(
              <div style={{marginTop:10,padding:"10px 12px",background:"#e6f1fb",borderRadius:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:13,color:"#185fa5"}}>Kişi başı toplam</span>
                <span style={{fontSize:15,fontWeight:700,color:"#185fa5"}}>{plan.budget.total_per_person}</span>
              </div>
            )}
            {plan.budget.total_group&&(
              <div style={{marginTop:6,padding:"10px 12px",background:"#eeedfe",borderRadius:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:13,color:"#534ab7"}}>Grup toplam</span>
                <span style={{fontSize:15,fontWeight:700,color:"#534ab7"}}>{plan.budget.total_group}</span>
              </div>
            )}
          </Section>
        )}

        {(plan.flight||plan.ulasim)&&(
          <Section icon={plan.ulasim?"🚌":"✈️"} title={plan.ulasim?"Ulaşım Bilgisi":"Uçuş Bilgisi"}>
            <p style={{margin:"0 0 6px",fontSize:13,lineHeight:1.6}}>{(plan.flight||plan.ulasim).info}</p>
            {(plan.flight||plan.ulasim).tip&&<p style={{margin:0,fontSize:12,color:"var(--color-text-secondary)",fontStyle:"italic"}}>💡 {(plan.flight||plan.ulasim).tip}</p>}
          </Section>
        )}

        {plan.weather&&(
          <Section icon="🌤️" title="Mevsim & Hava">
            <p style={{margin:0,fontSize:13,lineHeight:1.6}}>{plan.weather}</p>
          </Section>
        )}

        {(plan.hotels||fhInx)&&(
          <Section icon="🏨" title="Konaklama Önerileri">
            {fhInx&&(
              <div style={{marginBottom:10,padding:"10px 12px",background:"#e1f5ee",borderRadius:8,border:"0.5px solid #9fe1cb"}}>
                <p style={{margin:"0 0 6px",fontSize:11,fontWeight:600,color:"#0f6e56"}}>Küratöre Edilmiş Aile Otelleri</p>
                {fhInx.map((h,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:i<fhInx.length-1?6:0}}>
                    <div><p style={{margin:0,fontSize:12,fontWeight:500,color:"#085041"}}>{h.name}</p><p style={{margin:0,fontSize:11,color:"#0f6e56"}}>{h.area} — {h.note}</p></div>
                    <a href={`https://www.booking.com/search.tr.html?ss=${encodeURIComponent(h.name)}`} target="_blank" rel="noreferrer" style={{fontSize:11,color:"#0f6e56",textDecoration:"none",whiteSpace:"nowrap",marginLeft:8,padding:"3px 8px",border:"0.5px solid #0f6e56",borderRadius:5}}>Booking ›</a>
                  </div>
                ))}
              </div>
            )}
            {plan.hotels&&plan.hotels.map((h,i)=>{
              const bHotelUrl=`https://www.booking.com/search.tr.html?ss=${encodeURIComponent(h.name)}&checkin=${from}&checkout=${to}`;
              const gHotelUrl=`https://www.google.com/travel/hotels?q=${encodeURIComponent(h.name)}&dates=${from},${to}`;
              return(
              <div key={i} style={{padding:"10px 0",borderBottom:i<plan.hotels.length-1?"0.5px solid var(--color-border-tertiary)":"none"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <div style={{flex:1}}>
                    <p style={{margin:0,fontSize:13,fontWeight:500}}>{h.name}</p>
                    <p style={{margin:"2px 0 0",fontSize:11,color:"var(--color-text-secondary)"}}>{h.area}{h.note?` — ${h.note}`:""}</p>
                  </div>
                  {h.price&&(
                    <div style={{display:"flex",alignItems:"center",gap:6,marginLeft:8,flexShrink:0}}>
                      <span style={{fontSize:12,color:"var(--color-text-tertiary)",fontWeight:400,textDecoration:"line-through"}}>{h.price}</span>
                      <a href={bHotelUrl} target="_blank" rel="noreferrer" style={{fontSize:11,padding:"3px 8px",border:"0.5px solid #b5d4f4",borderRadius:6,background:"#e6f1fb",color:"#185fa5",textDecoration:"none",fontWeight:500,whiteSpace:"nowrap"}}>Fiyatı sorgula ↗</a>
                    </div>
                  )}
                </div>
              </div>
              );
            })}
          </Section>
        )}

        {plan.days&&plan.days.length>0&&(
          <div style={{marginBottom:18}}>
            <p style={{fontSize:11,fontWeight:600,color:"var(--color-text-tertiary)",textTransform:"uppercase",letterSpacing:"0.07em",margin:"0 0 10px"}}>📅 Günlük Program</p>
            <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:8,marginBottom:12}}>
              {plan.days.map((d,i)=>(
                <button key={i} onClick={()=>setActiveDay(i)} style={{flexShrink:0,padding:"6px 14px",borderRadius:20,border:`1.5px solid ${activeDay===i?"#378add":"var(--color-border-tertiary)"}`,background:activeDay===i?"#e6f1fb":"var(--color-background-primary)",color:activeDay===i?"#185fa5":"var(--color-text-secondary)",fontSize:12,fontWeight:activeDay===i?600:400,cursor:"pointer",whiteSpace:"nowrap"}}>
                  {d.day}. gün
                </button>
              ))}
            </div>
            {plan.days[activeDay]&&(
              <div style={{padding:"12px 14px",background:"var(--color-background-secondary)",borderRadius:12,border:"0.5px solid var(--color-border-tertiary)"}}>
                <p style={{margin:"0 0 12px",fontSize:14,fontWeight:600}}>{plan.days[activeDay].title}</p>
                {(plan.days[activeDay].slots||plan.days[activeDay].activities||[]).map((s,i)=>{
                  const isStr = typeof s === "string";
                  return(
                    <div key={i} style={{display:"flex",gap:10,marginBottom:10,paddingLeft:4}}>
                      <div style={{width:2,background:"var(--color-border-secondary)",borderRadius:2,flexShrink:0,marginTop:4}}/>
                      <div style={{flex:1}}>
                        {!isStr&&s.time&&<p style={{margin:"0 0 1px",fontSize:10,color:"var(--color-text-tertiary)",fontWeight:600,letterSpacing:"0.05em"}}>{s.time.toUpperCase()}</p>}
                        {!isStr&&s.place&&<p style={{margin:"0 0 2px",fontSize:13,fontWeight:500}}>{s.place}</p>}
                        <p style={{margin:0,fontSize:12,color:"var(--color-text-secondary)",lineHeight:1.5}}>{isStr?s:s.desc}</p>
                        {!isStr&&s.food&&<div style={{marginTop:4,display:"inline-flex",alignItems:"center",gap:4,padding:"3px 8px",borderRadius:16,background:"#faeeda",border:"0.5px solid #fac775"}}><span style={{fontSize:11}}>🍽️</span><span style={{fontSize:11,color:"#854f0b",fontWeight:500}}>{s.food}</span></div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {plan.tastes&&plan.tastes.length>0&&(
          <Section icon="🍽️" title="Mutlaka Dene">
            {plan.tastes.map((t,i)=>(
              <p key={i} style={{margin:i<plan.tastes.length-1?"0 0 6px":0,fontSize:12,lineHeight:1.5}}>· {t}</p>
            ))}
          </Section>
        )}

        {plan.tips&&plan.tips.length>0&&(
          <Section icon="💡" title="Seyahat Tavsiyeleri">
            {plan.tips.map((t,i)=>(
              <p key={i} style={{margin:i<plan.tips.length-1?"0 0 6px":0,fontSize:12,lineHeight:1.5}}>· {t}</p>
            ))}
          </Section>
        )}

        <div style={{marginTop:8,padding:"10px 14px",background:"#f0f7ff",borderRadius:10,border:"0.5px solid #dbeeff"}}>
          <p style={{margin:"0 0 4px",fontSize:12,fontWeight:600,color:"#185fa5"}}>📊 Bütçe Notu</p>
          <p style={{margin:0,fontSize:11,color:"#2a5080",lineHeight:1.6}}>Tahmini bütçe, geçmiş seyahat verilerine ve üst sınır hesaplamasına dayanır. Otel ve uçuş fiyatları doluluk oranı ile döviz kuruna göre <strong>%20–30 sapma</strong> gösterebilir. Kesin fiyat için Booking ve Skyscanner linklerini kullanın.</p>
        </div>
      </div>
    </div>
  );
}

function RecentSearches({searches,onSelect}) {
  if(!searches||searches.length===0) return null;
  return(
    <div style={{marginBottom:20}}>
      <SLabel>Son Aramalar</SLabel>
      {searches.map((s,i)=>{
        const c=[...CITIES,...CITIES_TR].find(x=>x.id===s.cityId);
        if(!c) return null;
        return(
          <div key={i} onClick={()=>onSelect(s)} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",marginBottom:6,border:"0.5px solid var(--color-border-tertiary)",borderRadius:10,cursor:"pointer",background:"var(--color-background-primary)"}}>
            <span style={{fontSize:20}}>{c.flag}</span>
            <div style={{flex:1}}>
              <p style={{margin:0,fontSize:13,fontWeight:500}}>{c.name}</p>
              <p style={{margin:0,fontSize:11,color:"var(--color-text-secondary)"}}>{fmtShort(s.from)} → {fmtShort(s.to)} · {MODS.find(m=>m.id===s.mod)?.label}</p>
            </div>
            <span style={{fontSize:12,color:"#378add"}}>Tekrar ›</span>
          </div>
        );
      })}
    </div>
  );
}

function PlanPage({onBack, planType="yurtdisi"}) {
  const isYurtici = planType === "yurtici";
  const cityList = isYurtici ? CITIES_TR : CITIES;
  const [city,setCity]=useState(null);
  const [from,setFrom]=useState("");
  const [to,setTo]=useState("");
  const [mod,setMod]=useState("aile");
  const [adults,setAdults]=useState(2);
  const [children,setChildren]=useState(0);
  const [childAges,setChildAges]=useState([]);
  const [note,setNote]=useState("");
  const [planResult,setPlanResult]=useState(null);
  const [loading,setLoading]=useState(false);
  const [status,setStatus]=useState("");
  const [error,setError]=useState("");
  const [searches,setSearches]=useState([]);

  useEffect(()=>{
    (async()=>{
      const val=await storageGet("gezgez-searches");
      if(val){ try{ setSearches(JSON.parse(val)); }catch(e){} }
    })();
  },[]);

  const handleChildren=(n)=>{
    setChildren(n);
    setChildAges(prev=>n>prev.length?[...prev,...Array(n-prev.length).fill(5)]:prev.slice(0,n));
  };

  const saveSearch=async(s)=>{
    setSearches(prev=>{
      const next=[s,...prev.filter(x=>!(x.cityId===s.cityId&&x.from===s.from&&x.to===s.to))].slice(0,3);
      storageSet("gezgez-searches",JSON.stringify(next));
      return next;
    });
  };

  const selMod=MODS.find(m=>m.id===mod);
  const canGo=city&&from&&to&&!loading;

  const go=async(ov={})=>{
    const _city=ov.city||city, _from=ov.from||from, _to=ov.to||to, _mod=ov.mod||mod;
    const _modLabel=MODS.find(m=>m.id===_mod)?.label||_mod;
    if(!_city||!_from||!_to) return;
    setLoading(true); setError(""); setPlanResult(null); setStatus("🌍 Rota hazırlanıyor...");
    try{
      const plan=await askGemini(buildPrompt(_city,_from,_to,_modLabel,adults,children,childAges,note,isYurtici));
      setPlanResult({plan,city:_city,from:_from,to:_to,mod:_mod});
      await saveSearch({cityId:_city.id,from:_from,to:_to,mod:_mod});
    }catch(err){
      setError("Hata: "+err.message+". Lütfen tekrar deneyin.");
    }
    setLoading(false); setStatus("");
  };

  const loadSearch=(s)=>{
    const c=cityList.find(x=>x.id===s.cityId);
    if(!c) return;
    setCity(c); setFrom(s.from); setTo(s.to); setMod(s.mod);
    setTimeout(()=>go({city:c,from:s.from,to:s.to,mod:s.mod}),0);
  };

  if(planResult) return <ResultView {...planResult} onReset={()=>setPlanResult(null)}/>;

  return(
    <div>
      <BgHeader height={90}><BackBtn onClick={onBack}/></BgHeader>
      <div style={{padding:"0 1.5rem 2rem",background:"var(--color-background-primary)"}}>
        <h2 style={{fontFamily:"Georgia,serif",fontWeight:400,fontSize:22,margin:"1.25rem 0 4px"}}>Tur Planla</h2>
        <p style={{color:"var(--color-text-secondary)",fontSize:13,margin:"0 0 20px"}}>Kişi sayısı, tarih ve tercihlerini gir.</p>

        <RecentSearches searches={searches} onSelect={loadSearch}/>

        <SLabel>Kişi Sayısı</SLabel>
        <div style={{display:"flex",gap:10,marginBottom:12}}>
          <Counter label="Yetişkin" sub="18+" value={adults} min={1} max={8} onChange={setAdults}/>
          <Counter label="Çocuk" sub="0–17 yaş" value={children} min={0} max={6} onChange={handleChildren}/>
        </div>
        {children>0&&(
          <div style={{marginBottom:20,padding:"12px 14px",background:"#f0f7ff",borderRadius:10,border:"0.5px solid #dbeeff"}}>
            <p style={{margin:"0 0 10px",fontSize:12,color:"#185fa5",fontWeight:500}}>Çocuk yaşları</p>
            <div style={{display:"flex",flexWrap:"wrap",gap:10}}>
              {childAges.map((age,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:6}}>
                  <span style={{fontSize:12,color:"var(--color-text-secondary)"}}>{i+1}. çocuk</span>
                  <select value={age} onChange={e=>setChildAges(prev=>{const a=[...prev];a[i]=Number(e.target.value);return a;})}
                    style={{padding:"6px 10px",border:"0.5px solid #b5d4f4",borderRadius:7,background:"var(--color-background-primary)",color:"var(--color-text-primary)",fontSize:13}}>
                    {Array.from({length:18},(_,k)=>k).map(y=><option key={y} value={y}>{y===0?"Bebek (0)":y+" yaş"}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}
        {children===0&&<div style={{marginBottom:20}}/>}

        <SLabel>Tarih</SLabel>
        <div style={{marginBottom:20}}>
          <DateRangePicker from={from} to={to} onChange={(f,t)=>{setFrom(f);setTo(t);}}/>
        </div>

        <SLabel>Seyahat Tarzı</SLabel>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:20}}>
          {MODS.map(m=>{
            const sel=mod===m.id;
            return(
              <div key={m.id} onClick={()=>setMod(m.id)} style={{border:`2px solid ${sel?"#378add":"var(--color-border-tertiary)"}`,borderRadius:10,padding:"12px 14px",cursor:"pointer",background:sel?"#e6f1fb":"var(--color-background-primary)",position:"relative"}}>
                {sel&&<span style={{position:"absolute",top:9,right:11,fontSize:13,color:"#185fa5",fontWeight:700}}>✓</span>}
                <p style={{margin:"0 0 3px",fontSize:14,fontWeight:500,color:sel?"#185fa5":"var(--color-text-primary)"}}>{m.icon} {m.label}</p>
                <p style={{margin:0,fontSize:12,color:"var(--color-text-secondary)",lineHeight:1.4}}>{m.desc}</p>
              </div>
            );
          })}
        </div>

        <SLabel>Destinasyon</SLabel>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:20}}>
          {cityList.map(c=>{
            const sel=city?.id===c.id;
            return(
              <div key={c.id} onClick={()=>setCity(c)} style={{border:`2px solid ${sel?"#378add":"var(--color-border-tertiary)"}`,borderRadius:8,padding:"10px 6px",cursor:"pointer",background:sel?"#e6f1fb":"var(--color-background-primary)",textAlign:"center",position:"relative"}}>
                {sel&&<span style={{position:"absolute",top:4,right:6,fontSize:10,color:"#185fa5",fontWeight:700}}>✓</span>}
                <p style={{margin:"0 0 3px",fontSize:22,lineHeight:1.2}}>{c.flag}</p>
                <p style={{margin:0,fontSize:11,color:sel?"#185fa5":"var(--color-text-primary)",fontWeight:sel?600:400}}>{c.name}</p>
              </div>
            );
          })}
        </div>

        <SLabel>Özel İstek <span style={{fontWeight:400,textTransform:"none",letterSpacing:0,fontSize:10,color:"var(--color-text-tertiary)"}}> — isteğe bağlı</span></SLabel>
        <div style={{position:"relative",marginBottom:22}}>
          <textarea value={note} onChange={e=>setNote(e.target.value.slice(0,150))}
            placeholder="ör: denize yakın otel, vejetaryen yemekler, müze ağırlıklı program..."
            rows={3}
            style={{width:"100%",padding:"10px 12px",border:"0.5px solid var(--color-border-secondary)",borderRadius:8,background:"var(--color-background-primary)",color:"var(--color-text-primary)",fontSize:13,lineHeight:1.55,resize:"none",boxSizing:"border-box",fontFamily:"inherit",display:"block"}}
          />
          <span style={{position:"absolute",bottom:8,right:10,fontSize:11,color:note.length>120?"#a32d2d":"var(--color-text-tertiary)",pointerEvents:"none"}}>{note.length}/150</span>
        </div>

        {error&&<p style={{fontSize:13,color:"#a32d2d",margin:"0 0 14px",background:"#fcebeb",padding:"10px 14px",borderRadius:8,lineHeight:1.5}}>{error}</p>}

        <button onClick={()=>go()} disabled={!canGo} style={{width:"100%",padding:"13px",border:`1.5px solid ${canGo?"#378add":"var(--color-border-tertiary)"}`,borderRadius:9,background:canGo?"#e6f1fb":"var(--color-background-secondary)",color:canGo?"#185fa5":"var(--color-text-tertiary)",cursor:canGo?"pointer":"not-allowed",fontSize:14,fontWeight:500}}>
          {loading
            ? <span style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                <span style={{width:14,height:14,border:"2px solid #b5d4f4",borderTopColor:"#185fa5",borderRadius:"50%",display:"inline-block",animation:"spin .8s linear infinite"}}/>
                {status||"Hazırlanıyor..."}
              </span>
            : canGo?`${selMod?.icon} ${city.name} — ${selMod?.label} turu planla →`:"Kişi, tarih ve şehir seç"}
        </button>
      </div>
    </div>
  );
}

function Landing({onSelectCat,onPlan}) {

  return(
    <div>
      <div style={{position:"relative",height:200,overflow:"hidden",borderRadius:"12px 12px 0 0"}}>
        <TravelBg/>
        <div style={{position:"relative",zIndex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",padding:"1rem"}}>
          <div style={{fontSize:44,marginBottom:6,marginTop:40}}>🧭</div>
          <h1 style={{fontFamily:"Georgia,serif",fontWeight:400,fontSize:28,margin:"0 0 6px",color:"#1a3a5c",textShadow:"0 1px 3px rgba(255,255,255,0.8)"}}>Gezgez</h1>
          <p style={{color:"#2a5080",fontSize:14,margin:0,fontWeight:500,textShadow:"0 1px 2px rgba(255,255,255,0.7)"}}>Gezgez ile her yer cebinde.</p>
        </div>
      </div>
      <div style={{padding:"1.5rem 1.5rem",background:"var(--color-background-primary)",borderRadius:"12px 12px 0 0",marginTop:-12,position:"relative",zIndex:1}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:24}}>
          <button onClick={()=>onPlan("yurtici")} style={{padding:"14px 10px",border:"1.5px solid #0f6e56",borderRadius:10,background:"#e1f5ee",color:"#0f6e56",cursor:"pointer",fontSize:14,fontWeight:500}}>🇹🇷 Yurtiçi Gezi Planla</button>
          <button onClick={()=>onPlan("yurtdisi")} style={{padding:"14px 10px",border:"1.5px solid #378add",borderRadius:10,background:"#e6f1fb",color:"#185fa5",cursor:"pointer",fontSize:14,fontWeight:500}}>✈️ Yurtdışı Gezi Planla</button>
        </div>
        <div style={{borderTop:"0.5px solid var(--color-border-tertiary)",paddingTop:20}}>
          <SLabel>Hazır Tur Rehberleri</SLabel>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            {Object.entries(TOURS).map(([k,cat])=>(
              <div key={k} className="gg-card" onClick={()=>onSelectCat(cat)} style={{padding:"16px"}}>
                <p style={{margin:"0 0 4px",fontSize:24}}>{cat.flag}</p>
                <p style={{margin:"0 0 4px",fontSize:15,fontWeight:500}}>{cat.label}</p>
                <p style={{margin:0,fontSize:12,color:"var(--color-text-secondary)"}}>{cat.tours.length} hazır tur</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CategoryPage({cat,onSelectTour,onBack}) {
  return(
    <div>
      <BgHeader><BackBtn onClick={onBack}/></BgHeader>
      <div style={{padding:"1.25rem 1.5rem",background:"var(--color-background-primary)"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:18}}>
          <span style={{fontSize:28}}>{cat.flag}</span>
          <h2 style={{fontFamily:"Georgia,serif",fontWeight:400,fontSize:22,margin:0}}>{cat.label} Turları</h2>
        </div>
        {cat.tours.map(t=>(
          <div key={t.id} className="gg-card" onClick={()=>onSelectTour(t)} style={{padding:"16px",marginBottom:10}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:14}}>
              <div style={{fontSize:32,lineHeight:1}}>{t.cover}</div>
              <div style={{flex:1}}>
                <p style={{margin:"0 0 4px",fontSize:15,fontWeight:500}}>{t.title}</p>
                <p style={{margin:"0 0 10px",fontSize:13,color:"var(--color-text-secondary)"}}>{t.subtitle}</p>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}><Tag>{t.duration}</Tag><Tag>{t.budget}</Tag>{t.tags.map(tg=><Tag key={tg}>{tg}</Tag>)}</div>
              </div>
              <span style={{color:"var(--color-text-tertiary)",fontSize:20,alignSelf:"center"}}>›</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TourDetail({tour,onBack}) {
  return(
    <div>
      <BgHeader><BackBtn onClick={onBack}/></BgHeader>
      <div style={{padding:"1.25rem 1.5rem",background:"var(--color-background-primary)"}}>
        <h2 style={{fontFamily:"Georgia,serif",fontWeight:400,fontSize:22,margin:"0 0 4px"}}>{tour.title}</h2>
        <p style={{color:"var(--color-text-secondary)",fontSize:13,margin:"0 0 12px"}}>{tour.subtitle}</p>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:22}}><Tag>{tour.duration}</Tag><Tag>{tour.budget}</Tag>{tour.tags.map(t=><Tag key={t}>{t}</Tag>)}</div>
        {tour.days.map(d=>(
          <div key={d.day} style={{marginBottom:24}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
              <div style={{width:28,height:28,borderRadius:"50%",background:"#e6f1fb",color:"#185fa5",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:600,flexShrink:0}}>{d.day}</div>
              <p style={{margin:0,fontSize:15,fontWeight:500}}>{d.title}</p>
            </div>
            {d.slots.map((s,i)=>(
              <div key={i} style={{display:"flex",gap:12,marginBottom:14,paddingLeft:6}}>
                <div style={{width:2,background:"var(--color-border-secondary)",borderRadius:2,flexShrink:0,marginTop:4}}/>
                <div style={{flex:1}}>
                  <p style={{margin:"0 0 2px",fontSize:11,color:"var(--color-text-tertiary)",fontWeight:600,letterSpacing:"0.05em"}}>{s.time.toUpperCase()}</p>
                  <p style={{margin:"0 0 3px",fontSize:14,fontWeight:500}}>{s.place}</p>
                  <p style={{margin:"0 0 6px",fontSize:13,color:"var(--color-text-secondary)",lineHeight:1.55}}>{s.desc}</p>
                  {s.food&&<div style={{display:"inline-flex",alignItems:"center",gap:6,padding:"4px 11px",borderRadius:20,background:"#faeeda",border:"0.5px solid #fac775"}}><span>🍽️</span><span style={{fontSize:12,color:"#854f0b",fontWeight:500}}>{s.food.name}</span>{s.food.note&&<span style={{fontSize:11,color:"#854f0b"}}> — {s.food.note}</span>}</div>}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Gezgez() {
  const [page,setPage]=useState({view:"landing"});
  return(
    <>
      <style>{CSS}</style>
      <div style={{border:"0.5px solid var(--color-border-tertiary)",borderRadius:14,overflow:"hidden"}}>
        {page.view==="landing"  &&<Landing  onSelectCat={cat=>setPage({view:"category",cat})} onPlan={(type)=>setPage({view:"plan",planType:type})}/>}
        {page.view==="category" &&<CategoryPage cat={page.cat} onSelectTour={t=>setPage({view:"tour",tour:t,cat:page.cat})} onBack={()=>setPage({view:"landing"})}/>}
        {page.view==="tour"     &&<TourDetail tour={page.tour} onBack={()=>setPage({view:"category",cat:page.cat})}/>}
        {page.view==="plan"     &&<PlanPage onBack={()=>setPage({view:"landing"})} planType={page.planType}/>}
      </div>
    </>
  );
}
