import React, { useEffect, useState } from 'react';
import { t, LOCALES } from './i18n';
import Inventory from './pages/Inventory';
import ScanPage from './pages/Scan';

export default function App(){
  const [locale, setLocale] = useState(LOCALES.en);
  const [dir, setDir] = useState('ltr');

  useEffect(()=> {
    setDir(locale === LOCALES.ar ? 'rtl' : 'ltr');
    document.documentElement.lang = locale === LOCALES.cn ? 'zh' : (locale === LOCALES.ar ? 'ar' : 'en');
    document.documentElement.dir = dir;
  }, [locale, dir]);

  const [view, setView] = useState('inventory');
  return (
    <div className={dir==='rtl' ? 'rtl' : ''}>
      <div className="container">
        <header>
          <div>
            <div className="brand">{t(locale,'title')}</div>
            <div className="small">{t(locale,'warehouse')}</div>
          </div>
          <div className="row">
            <nav>
              <a href="#" onClick={(e)=>{e.preventDefault(); setView('inventory')}}>{t(locale,'inventory')}</a>
              <a href="#" onClick={(e)=>{e.preventDefault(); setView('scan')}}>{t(locale,'scan')}</a>
            </nav>
            <select value={locale} onChange={e=>setLocale(e.target.value)}>
              <option value={LOCALES.en}>English</option>
              <option value={LOCALES.ar}>العربية</option>
              <option value={LOCALES.cn}>中文</option>
            </select>
          </div>
        </header>

        <div className="card">
          {view === 'inventory' && <Inventory locale={locale} />}
          {view === 'scan' && <ScanPage locale={locale} />}
        </div>
      </div>
    </div>
  );
}
