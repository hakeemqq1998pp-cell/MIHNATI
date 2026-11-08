import React,{useEffect,useRef}from'react';
import L from'leaflet';
import'leaflet/dist/leaflet.css';

export default function LiveMap({worker,owner,destination}){
 const host=useRef(null),map=useRef(null),markers=useRef({});
 useEffect(()=>{
  if(!host.current||map.current)return;
  const m=L.map(host.current,{zoomControl:true,scrollWheelZoom:false}).setView([33.3152,44.3661],6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(m);
  map.current=m;
  return()=>{m.remove();map.current=null;markers.current={};};
 },[]);
 useEffect(()=>{
  const m=map.current;if(!m)return;
  const points=[
   ['worker',worker,'العامل','worker-pin'],
   ['owner',owner,'صاحب العمل','owner-pin'],
   ['destination',destination,'موقع العمل','destination-pin']
  ].filter(x=>x[1]&&Number.isFinite(Number(x[1].latitude))&&Number.isFinite(Number(x[1].longitude)));
  const keep=new Set(points.map(x=>x[0]));
  Object.keys(markers.current).forEach(k=>{if(!keep.has(k)){m.removeLayer(markers.current[k]);delete markers.current[k];}});
  const bounds=[];
  points.forEach(([key,p,label,cls])=>{
   const lat=Number(p.latitude),lng=Number(p.longitude);bounds.push([lat,lng]);
   const html='<span class="pin-dot '+cls+'">'+(key==='worker'?'ع':key==='owner'?'ص':'م')+'</span>';
   const icon=L.divIcon({className:'mihnati-map-icon',html,iconSize:[34,34],iconAnchor:[17,17]});
   if(markers.current[key])markers.current[key].setLatLng([lat,lng]);
   else markers.current[key]=L.marker([lat,lng],{icon}).addTo(m);
   markers.current[key].bindTooltip(label,{direction:'top'});
  });
  if(bounds.length>1)m.fitBounds(bounds,{padding:[28,28],maxZoom:16});
  else if(bounds.length===1)m.setView(bounds[0],15);
 },[worker?.latitude,worker?.longitude,owner?.latitude,owner?.longitude,destination?.latitude,destination?.longitude]);
 return <div className="live-map-wrap"><div ref={host} className="live-map"/><div className="map-legend"><span><i className="worker-key"/> العامل</span><span><i className="owner-key"/> صاحب العمل</span><span><i className="destination-key"/> موقع العمل</span></div></div>;
}
