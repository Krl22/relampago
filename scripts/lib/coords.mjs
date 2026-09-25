// Extrae coordenadas de una dirección escrita a mano: grados/minutos/segundos
// (12°12'01.1"S 76°56'21.5"W), decimales (-12.1234, -76.9876), URLs de Google Maps con @lat,lng
// o Plus Codes (Q3X6+V7F Villa El Salvador), que se recuperan con el centro del distrito.
import olc from "open-location-code";

const OLC = new olc.OpenLocationCode();

// Centros aproximados de distritos de Lima/Callao (referencia para Plus Codes cortos)
export const DISTRICT_CENTERS = {
  "cercado": [-12.0464, -77.0428], "miraflores": [-12.1211, -77.03], "san isidro": [-12.0975, -77.0364],
  "surco": [-12.1462, -76.9906], "san borja": [-12.1067, -76.9997], "surquillo": [-12.1147, -77.018],
  "la victoria": [-12.0679, -77.0175], "lince": [-12.0864, -77.0333], "jesus maria": [-12.0731, -77.0473],
  "pueblo libre": [-12.0764, -77.064], "magdalena": [-12.0908, -77.0708], "san miguel": [-12.0778, -77.0908],
  "breña": [-12.0597, -77.0503], "rimac": [-12.0262, -77.0341], "san martin de porres": [-12.0011, -77.0713],
  "los olivos": [-11.9822, -77.0736], "independencia": [-11.9895, -77.0538], "comas": [-11.94, -77.06],
  "carabayllo": [-11.88, -77.03], "puente piedra": [-11.8636, -77.0752], "callao": [-12.0566, -77.1181],
  "ventanilla": [-11.8757, -77.1252], "san juan de lurigancho": [-11.98, -77.0], "el agustino": [-12.04, -76.999],
  "santa anita": [-12.0431, -76.97], "ate": [-12.03, -76.92], "la molina": [-12.08, -76.93], "san luis": [-12.075, -77.0],
  "chorrillos": [-12.17, -77.02], "barranco": [-12.1467, -77.0206], "san juan de miraflores": [-12.16, -76.97],
  "villa maria del triunfo": [-12.16, -76.94], "villa el salvador": [-12.21, -76.94], "lurin": [-12.275, -76.87],
  "pachacamac": [-12.23, -76.86], "lurigancho": [-11.94, -76.7],
};
const LIMA = [-12.0464, -77.0428];

const norm = (s) =>
  (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const inLima = (lat, lng) => lat > -12.6 && lat < -11.6 && lng > -77.3 && lng < -76.5;

export function parseCoords(text, district) {
  if (!text) return null;
  const t = text.replace(/[\u2019\u2032]/g, "'").replace(/[\u201d\u2033]/g, '"');

  // 12°12'01.1"S 76°56'21.5"W
  const dms = t.match(/(\d{1,2})[°º]\s*(\d{1,2})'\s*([\d.]+)"?\s*([NS])[\s,/]+(\d{1,3})[°º]\s*(\d{1,2})'\s*([\d.]+)"?\s*([EW])/i);
  if (dms) {
    const lat = (Number(dms[1]) + Number(dms[2]) / 60 + Number(dms[3]) / 3600) * (dms[4].toUpperCase() === "S" ? -1 : 1);
    const lng = (Number(dms[5]) + Number(dms[6]) / 60 + Number(dms[7]) / 3600) * (dms[8].toUpperCase() === "W" ? -1 : 1);
    if (inLima(lat, lng)) return { lat, lng, source: "dms" };
  }

  // -12.123456, -76.987654 (o @-12.1,-76.9 en URLs)
  const dec = t.match(/(-1[12]\.\d{3,})\s*,\s*(-7[67]\.\d{3,})/);
  if (dec) {
    const lat = Number(dec[1]);
    const lng = Number(dec[2]);
    if (inLima(lat, lng)) return { lat, lng, source: "decimal" };
  }

  // Plus code: 4+3 ó 2+3 (cortos) o completo 8+3
  const plus = t.match(/\b([23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{2,3})\b/i);
  if (plus) {
    const code = plus[1].toUpperCase();
    try {
      let full = code;
      if (OLC.isShort(code)) {
        const [rlat, rlng] = DISTRICT_CENTERS[norm(district)] ?? LIMA;
        full = OLC.recoverNearest(code, rlat, rlng);
      }
      const area = OLC.decode(full);
      if (inLima(area.latitudeCenter, area.longitudeCenter)) return { lat: area.latitudeCenter, lng: area.longitudeCenter, source: "pluscode" };
    } catch {
      /* código inválido: se ignora */
    }
  }
  return null;
}
