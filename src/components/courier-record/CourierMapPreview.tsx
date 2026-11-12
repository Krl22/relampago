import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";

export default function CourierMapPreview({
  lat,
  lng,
}: {
  lat: number;
  lng: number;
}) {
  return (
    <div className="relative isolate z-0 h-72 overflow-hidden rounded-md border">
      <MapContainer
        key={`${lat}:${lng}`}
        center={[lat, lng]}
        zoom={15}
        scrollWheelZoom={false}
        className="h-full w-full"
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        <CircleMarker
          center={[lat, lng]}
          radius={9}
          pathOptions={{
            color: "#0b5cab",
            fillColor: "#0b5cab",
            fillOpacity: 0.9,
            weight: 3,
          }}
        >
          <Popup>Última ubicación reportada</Popup>
        </CircleMarker>
      </MapContainer>
    </div>
  );
}
