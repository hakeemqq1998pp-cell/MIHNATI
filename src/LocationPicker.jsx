import React,{useEffect,useRef}from'react';
import L from'leaflet';
import'leaflet/dist/leaflet.css';

export default function LocationPicker({value,onChange}){
 const host=useRef(null),map=useRef(null),marker=useRef(null),changeRef=useRef(onChange);
 useEffect(()=>{changeRef.current=onChange;},[onChange]);
 useEffect(()=>{
  if(!host.current||map.current)return;
  const initial=value?[Number(value.latitude),Number(value.longitude)]:[32.025,44.335];
  const m=L.map(host.current,{scrollWheelZoom:false}).setView(initial,value?16:11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(m);
  m.on('click',event=>{
   const next={latitude:event.latlng.lat,longitude:event.latlng.lng};
   changeRef.current?.(next);
  });
  map.current=m;
  return()=>{m.remove();map.current=null;marker.current=null;};
 },[]);
 useEffect(()=>{
  const m=map.current;if(!m||!value)return;
  const coords=[Number(value.latitude),Number(value.longitude)];
  if(!marker.current)marker.current=L.marker(coords).addTo(m);
  else marker.current.setLatLng(coords);
  m.setView(coords,16);
 },[value?.latitude,value?.longitude]);
 return <div className="location-picker"><div ref={host} className="location-picker-map"/><p>اضغط على الخريطة لتحديد نقطة العمل بدقة، أو استخدم زر تحديد موقعي.</p></div>;
}
