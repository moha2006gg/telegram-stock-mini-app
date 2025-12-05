import React, { useEffect, useState } from 'react';
import { t } from '../i18n';

export default function Inventory({ locale }){
  const [items, setItems] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [selectedW, setSelectedW] = useState('');

  useEffect(()=>{
    fetch('/api/public_items').then(r=>r.json()).then(setItems).catch(()=>{});
    fetch('/api/public_warehouses').then(r=>r.json()).then(setWarehouses).catch(()=>{});
  },[]);

  const filtered = selectedW ? items.filter(i=>i.warehouseId===selectedW) : items;

  return (
    <div>
      <div className="row">
        <h2>{t(locale,'inventory')}</h2>
        <select onChange={e=>setSelectedW(e.target.value)} value={selectedW}>
          <option value="">{t(locale,'warehouse')}</option>
          {warehouses.map(w=> <option key={w._id} value={String(w._id)}>{w.name}</option>)}
        </select>
      </div>

      <div className="grid">
        {filtered.map(it=>(
          <div className="item" key={it.sku || it._id}>
            <div style={{fontWeight:700}}>{it.name}</div>
            <div className="small">{t(locale,'sku')}: {it.sku}</div>
            <div className="small">{t(locale,'qty')}: {it.qty}</div>
            {it.modelUrl && <div style={{marginTop:8}}>
              <a href={`/public/3d.html?model=${encodeURIComponent(it.modelUrl)}`} target="_blank" rel="noreferrer">{t(locale,'view3d')}</a>
            </div>}
          </div>
        ))}
      </div>
    </div>
  );
}
