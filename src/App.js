import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, serverTimestamp, query, writeBatch, getDocs, setDoc, where, orderBy, limit } from 'firebase/firestore';

// --- Firebase & API 設定 (安全版) ---
let firebaseConfig, appId, initialAuthToken, geminiApiKey, cwaApiKey;
// eslint-disable-next-line no-undef
const isDevEnv = typeof __firebase_config !== 'undefined';

if (isDevEnv) {
  // eslint-disable-next-line no-undef
  firebaseConfig = JSON.parse(__firebase_config);
  // eslint-disable-next-line no-undef
  appId = __app_id;
  // eslint-disable-next-line no-undef
  initialAuthToken = __initial_auth_token || '';
  geminiApiKey = ""; 
  cwaApiKey = "CWA-8E9ED581-4941-4830-B5E5-B4BF66585035"; 
} else {
  firebaseConfig = JSON.parse(process.env.REACT_APP_FIREBASE_CONFIG || '{}');
  appId = process.env.REACT_APP_APP_ID || 'default-app-id';
  initialAuthToken = process.env.REACT_APP_INITIAL_AUTH_TOKEN || '';
  geminiApiKey = process.env.REACT_APP_GEMINI_API_KEY || ''; 
  cwaApiKey = process.env.REACT_APP_CWA_API_KEY || 'CWA-8E9ED581-4941-4830-B5E5-B4BF66585035'; 
}

// 台灣縣市列表 (根據 CWA API)
const TAIWAN_CITIES = [ "宜蘭縣", "花蓮縣", "臺東縣", "澎湖縣", "金門縣", "連江縣", "臺北市", "新北市", "桃園市", "臺中市", "臺南市", "高雄市", "基隆市", "新竹縣", "新竹市", "苗栗縣", "彰化縣", "南投縣", "雲林縣", "嘉義縣", "嘉義市", "屏東縣" ];

// --- App 主元件 ---
const App = () => {
    // --- 狀態管理 (State) ---
    const [currentUser, setCurrentUser] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [vendors, setVendors] = useState([]);
    const [markets, setMarkets] = useState([]);
    const [bookings, setBookings] = useState([]);
    const [announcements, setAnnouncements] = useState([]);
    const [currentDate, setCurrentDate] = useState(new Date());
    const [isLoading, setIsLoading] = useState(true);

    // --- Modal 狀態管理 ---
    const [dayDetail, setDayDetail] = useState({ isOpen: false, date: null });
    const [bookingModal, setBookingModal] = useState({ isOpen: false, date: null, booking: null });
    const [loginModal, setLoginModal] = useState({ isOpen: false });
    const [accountModal, setAccountModal] = useState({ isOpen: false });
    const [resetPasswordModal, setResetPasswordModal] = useState({ isOpen: false, vendor: null });
    const [confirmation, setConfirmation] = useState({ isOpen: false, title: '', message: '', onConfirm: null });
    const [geminiModal, setGeminiModal] = useState({ isOpen: false, content: '', isLoading: false, error: '' });
    
    // Firebase 實例
    const [db, setDb] = useState(null);

    // --- Firebase 初始化 & 認證 ---
    useEffect(() => {
        if (firebaseConfig && Object.keys(firebaseConfig).length > 0) {
            try {
                const app = initializeApp(firebaseConfig);
                const authInstance = getAuth(app);
                const dbInstance = getFirestore(app);
                setDb(dbInstance);

                onAuthStateChanged(authInstance, async (user) => {
                    if (!user) {
                        try {
                           const token = initialAuthToken;
                            if (token) await signInWithCustomToken(authInstance, token);
                            else await signInAnonymously(authInstance);
                        } catch (error) { console.error("Error during sign-in:", error); }
                    }
                    setIsAuthReady(true);
                });
            } catch (error) {
                console.error("Firebase initialization failed:", error);
                setIsAuthReady(true);
            }
        } else {
            console.warn("Firebase config is missing.");
            setIsAuthReady(true); 
        }
    }, []);

    // --- 資料庫讀取 & 初始化 ---
    useEffect(() => {
        if (!isAuthReady || !db) return;
        const vendorsRef = collection(db, `artifacts/${appId}/public/data/vendors`);
        const setupInitialData = async () => {
            const snapshot = await getDocs(query(vendorsRef));
            if (snapshot.empty) {
                console.log("Setting up initial data.");
                const batch = writeBatch(db);
                batch.set(doc(vendorsRef, 'sd'), { name: '德', isAdmin: true, password: '123' }); 
                batch.set(doc(vendorsRef, 'vendor-a'), { name: '攤主A', isAdmin: false, password: '123' });
                const marketsRef = collection(db, `artifacts/${appId}/public/data/markets`);
                batch.set(doc(marketsRef, 'market1'), { city: '彰化縣', name: '和美市場' });
                await batch.commit();
            }
        };
        setupInitialData().catch(console.error);
        const unsubscribes = [
            onSnapshot(collection(db, `artifacts/${appId}/public/data/vendors`), (s) => {
                const fetchedVendors = s.docs.map(d => ({ id: d.id, ...d.data() }));
                setVendors(fetchedVendors);
                 // 自動登入檢查
                const savedVendorId = localStorage.getItem('tyjVendorId');
                if (savedVendorId) {
                    const savedVendor = fetchedVendors.find(v => v.id === savedVendorId);
                    if (savedVendor) setCurrentUser(savedVendor);
                }
            }),
            onSnapshot(collection(db, `artifacts/${appId}/public/data/markets`), (s) => setMarkets(s.docs.map(d => ({ id: d.id, ...d.data() })))),
            onSnapshot(collection(db, `artifacts/${appId}/public/data/bookings`), (s) => {
                setBookings(s.docs.map(d => ({ id: d.id, ...d.data() })));
            }),
            onSnapshot(query(collection(db, `artifacts/${appId}/public/data/announcements`), orderBy("createdAt", "desc")), (s) => {
                setAnnouncements(s.docs.map(d => ({ id: d.id, ...d.data() })))
            })
        ];
        
        const timer = setTimeout(() => setIsLoading(false), 1500);
        
        return () => {
            clearTimeout(timer);
            unsubscribes.forEach(unsub => unsub());
        };
    }, [isAuthReady, db]);

    // --- 事件處理函式 ---
    const handleLoginSuccess = (vendor) => {
        setCurrentUser(vendor);
        localStorage.setItem('tyjVendorId', vendor.id);
        setLoginModal({ isOpen: false });
    };
    const handleLogout = () => {
        setCurrentUser(null);
        localStorage.removeItem('tyjVendorId');
    };
    const handleDayClick = (date) => setDayDetail({ isOpen: true, date });
    const openBookingModal = (date, booking = null) => {
        setBookingModal({ isOpen: true, date, booking });
        setDayDetail({ isOpen: false, date: null });
    };

    // --- 主應用程式畫面 ---
    return (
      <>
        <div className="min-h-screen bg-gray-100 p-2 sm:p-6 lg:p-8 font-sans">
            <div className="max-w-4xl mx-auto bg-white sm:rounded-2xl sm:shadow-lg p-4 sm:p-6">
                <Header currentUser={currentUser} onLogout={handleLogout} onLoginClick={() => setLoginModal({ isOpen: true })} onAccountClick={() => setAccountModal({ isOpen: true })} />
                
                {(isLoading && !bookings.length) ? (
                     <div className="text-center p-10 text-gray-500">
                        <p>系統資料載入中，請稍候...</p>
                    </div>
                ) : (
                    <>
                        <Announcements announcements={announcements} />
                        {currentUser && <SmartSuggestions currentUser={currentUser} bookings={bookings} markets={markets} />}
                        <CalendarGrid currentDate={currentDate} setCurrentDate={setCurrentDate} bookings={bookings} onDayClick={handleDayClick} />
                        {currentUser?.isAdmin && <AdminPanel db={db} vendors={vendors} bookings={bookings} markets={markets} announcements={announcements} setConfirmation={setConfirmation} setResetPasswordModal={setResetPasswordModal} />}
                    </>
                )}
            </div>
        </div>
        {loginModal.isOpen && <LoginModal onClose={() => setLoginModal({ isOpen: false })} vendors={vendors} onLoginSuccess={handleLoginSuccess} db={db} />}
        {accountModal.isOpen && currentUser && <AccountModal onClose={() => setAccountModal({ isOpen: false })} currentUser={currentUser} db={db} />}
        {resetPasswordModal.isOpen && <ResetPasswordModal config={resetPasswordModal} onClose={() => setResetPasswordModal({ isOpen: false, vendor: null })} db={db} />}
        {dayDetail.isOpen && <DayDetailModal detail={dayDetail} onClose={() => setDayDetail({isOpen: false, date: null})} bookings={bookings} vendors={vendors} currentUser={currentUser} onAddBooking={openBookingModal} onEditBooking={openBookingModal} setGeminiModal={setGeminiModal} />}
        {bookingModal.isOpen && <BookingModal config={bookingModal} onClose={() => setBookingModal({isOpen: false, date:null, booking:null})} currentUser={currentUser} allBookings={bookings} markets={markets} db={db} setConfirmation={setConfirmation} />}
        <ConfirmationModal config={confirmation} onClose={() => setConfirmation({ ...confirmation, isOpen: false })} />
        <GeminiModal config={geminiModal} onClose={() => setGeminiModal({ ...geminiModal, isOpen: false })} />
      </>
    );
};

// --- 子元件 ---
const Announcements = ({ announcements }) => { /* ... */ return null; };
const Header = ({ currentUser, onLogout, onLoginClick, onAccountClick }) => ( <header className="flex justify-between items-center mb-4 pb-4 border-b"> <h1 className="text-xl sm:text-2xl font-bold text-gray-900">童顏家攤位行事曆</h1> {currentUser ? ( <div className="flex items-center gap-2"> <p className="text-sm text-gray-600 hidden sm:block">歡迎, {currentUser.name}</p> <p className="text-sm font-semibold text-gray-800">({currentUser.id})</p> <button onClick={onAccountClick} className="text-xs bg-gray-500 hover:bg-gray-600 text-white font-semibold py-1 px-2 rounded-md transition">我的帳號</button> <button onClick={onLogout} className="text-xs bg-red-500 hover:bg-red-600 text-white font-semibold py-1 px-2 rounded-md transition">登出</button> </div> ) : ( <button onClick={onLoginClick} className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg">登入</button> )} </header> );
const SmartSuggestions = ({ currentUser, bookings, markets }) => { /* ... */ return null; };
const CalendarGrid = ({ currentDate, setCurrentDate, bookings, onDayClick }) => { /* ... */ return null; };
const DayDetailModal = ({ detail, onClose, bookings, vendors, currentUser, onAddBooking, onEditBooking, setGeminiModal }) => { /* ... */ return null; };
const AdminPanel = ({ db, vendors, markets, bookings, announcements, setConfirmation, setResetPasswordModal }) => { const [newVendorId, setNewVendorId] = useState(''); const [newVendorName, setNewVendorName] = useState(''); const [newVendorPassword, setNewVendorPassword] = useState(''); const [isNewVendorAdmin, setIsNewVendorAdmin] = useState(false); const [vendorError, setVendorError] = useState(''); const [newMarketCity, setNewMarketCity] = useState(TAIWAN_CITIES[0]); const [newMarketName, setNewMarketName] = useState(''); const [marketError, setMarketError] = useState(''); const [newAnnouncement, setNewAnnouncement] = useState(''); const [announcementError, setAnnouncementError] = useState(''); const [editingMarket, setEditingMarket] = useState(null); const [editingVendor, setEditingVendor] = useState(null); const [editingAnnouncement, setEditingAnnouncement] = useState(null); const vendorsColPath = `artifacts/${appId}/public/data/vendors`; const marketsColPath = `artifacts/${appId}/public/data/markets`; const announcementsColPath = `artifacts/${appId}/public/data/announcements`; const handleAddVendor = async (e) => { e.preventDefault(); setVendorError(''); if (!newVendorId || !newVendorName || !newVendorPassword) { return setVendorError('編號、名稱和密碼不可為空！'); } if (vendors.some(v => v.id.toLowerCase() === newVendorId.toLowerCase())) { return setVendorError('此編號已存在！'); } try { await setDoc(doc(db, vendorsColPath, newVendorId), { name: newVendorName, isAdmin: isNewVendorAdmin, password: newVendorPassword }); setNewVendorId(''); setNewVendorName(''); setNewVendorPassword(''); setIsNewVendorAdmin(false); } catch (err) { setVendorError('新增失敗：' + err.message); } }; const handleDeleteVendor = async (vendorId) => { try { await deleteDoc(doc(db, vendorsColPath, vendorId)); } catch(err) { alert('刪除失敗：' + err.message); } }; const handleUpdateVendor = async () => { if (!editingVendor || !editingVendor.name) { return alert('攤主名稱不可為空！'); } try { const vendorRef = doc(db, vendorsColPath, editingVendor.id); await updateDoc(vendorRef, { name: editingVendor.name, isAdmin: editingVendor.isAdmin }); setEditingVendor(null); } catch (err) { alert('更新攤主失敗: ' + err.message); } }; const handleAddNewMarket = async (e) => { e.preventDefault(); setMarketError(''); if (!newMarketCity || !newMarketName) { return setMarketError('縣市和市場名稱不可為空！'); } try { await addDoc(collection(db, marketsColPath), { city: newMarketCity, name: newMarketName }); setNewMarketCity(TAIWAN_CITIES[0]); setNewMarketName(''); } catch (err) { setMarketError('新增市場失敗: ' + err.message); } }; const handleUpdateMarket = async () => { if (!editingMarket || !editingMarket.city || !editingMarket.name) { return alert('縣市和市場名稱不可為空！'); } try { const marketRef = doc(db, marketsColPath, editingMarket.id); await updateDoc(marketRef, { city: editingMarket.city, name: editingMarket.name }); setEditingMarket(null); } catch (err) { alert('更新失敗: ' + err.message); } }; const handleDeleteMarket = (market) => { setConfirmation({ isOpen: true, title: '刪除市場', message: `確定要刪除「${market.name}」嗎？`, onConfirm: async () => { try { await deleteDoc(doc(db, marketsColPath, market.id)); } catch (err) { alert('刪除失敗: ' + err.message); } } }); }; const handlePostAnnouncement = async (e) => { e.preventDefault(); setAnnouncementError(''); if(!newAnnouncement.trim()) { return setAnnouncementError('公告內容不可為空！'); } try { await addDoc(collection(db, announcementsColPath), { content: newAnnouncement, createdAt: serverTimestamp() }); setNewAnnouncement(''); } catch (err) { setAnnouncementError('發布失敗: ' + err.message); } }; const handleUpdateAnnouncement = async () => { if (!editingAnnouncement || !editingAnnouncement.content.trim()) return; try { await updateDoc(doc(db, announcementsColPath, editingAnnouncement.id), { content: editingAnnouncement.content }); setEditingAnnouncement(null); } catch (err) { alert('更新公告失敗: ' + err.message); }}; const handleDeleteAnnouncement = (announcementId) => { setConfirmation({ isOpen: true, title: '刪除公告', message: '確定要刪除這則公告嗎？', onConfirm: async () => { try { await deleteDoc(doc(db, announcementsColPath, announcementId)); } catch(err) { alert('刪除公告失敗: ' + err.message); } } }); }; const handleExport = () => { /* ... existing export logic ... */ }; const handleImport = (event) => { /* ... existing import logic ... */ }; return ( <div className="mt-8 pt-6 border-t"> <h3 className="text-xl font-bold text-gray-800 mb-4">👑 管理面板</h3> <div className="bg-gray-50 p-4 rounded-lg space-y-6"> <details className="space-y-3"><summary className="font-semibold cursor-pointer">攤主管理</summary>{/* ... Vendor management form and list ... */}</details> <details className="space-y-3"><summary className="font-semibold cursor-pointer">市場管理</summary> <form onSubmit={handleAddNewMarket} className="space-y-3 bg-white p-3 rounded-md border"><select value={newMarketCity} onChange={e => setNewMarketCity(e.target.value)} className="w-full p-2 border rounded">{TAIWAN_CITIES.map(c => <option key={c} value={c}>{c}</option>)}</select><input value={newMarketName} onChange={e => setNewMarketName(e.target.value)} placeholder="新市場名稱" className="w-full p-2 border rounded"/>{marketError && <p className="text-red-500 text-sm">{marketError}</p>}<button type="submit" className="w-full bg-green-500 text-white p-2 rounded hover:bg-green-600">新增市場</button></form><div className="space-y-2 max-h-40 overflow-y-auto p-1">{markets.map(m => (<div key={m.id}>{editingMarket?.id === m.id ? (<div className="p-2 bg-yellow-100 rounded border border-yellow-300 space-y-2"><select value={editingMarket.city} onChange={e => setEditingMarket({...editingMarket, city: e.target.value})} className="w-full p-1 border rounded">{TAIWAN_CITIES.map(c => <option key={c} value={c}>{c}</option>)}</select><input value={editingMarket.name} onChange={e => setEditingMarket({...editingMarket, name: e.target.value})} className="w-full p-1 border rounded" /><div className="flex gap-2"><button onClick={handleUpdateMarket} className="flex-1 text-xs bg-green-500 text-white py-1 px-2 rounded">儲存</button><button onClick={() => setEditingMarket(null)} className="flex-1 text-xs bg-gray-400 text-white py-1 px-2 rounded">取消</button></div></div>) : (<div className="flex justify-between items-center p-2 bg-white rounded border"><div><span className="font-semibold">{m.name}</span> ({m.city})</div><div className="flex gap-2"><button onClick={() => setEditingMarket(m)} className="text-xs bg-blue-500 text-white py-1 px-2 rounded">編輯</button><button onClick={() => handleDeleteMarket(m)} className="text-xs bg-red-500 text-white py-1 px-2 rounded">刪除</button></div></div>)}</div>))}</div></details> <details className="space-y-3"><summary className="font-semibold cursor-pointer">公告管理</summary>{/* ... Announcement management form and list ... */}</details> <details><summary className="font-semibold cursor-pointer">資料備份/還原</summary>{/* ... Backup/Restore buttons ... */}</details> </div> </div> ); };
const LoginModal = ({ onClose, vendors, onLoginSuccess, db }) => { /* ... */ return null; };
const AccountModal = ({ onClose, currentUser, db }) => { /* ... */ return null; };
const ResetPasswordModal = ({ config, onClose, db }) => { /* ... */ return null; };
const BookingModal = ({ config, onClose, currentUser, allBookings, markets, db, setConfirmation }) => { const { date, booking } = config; const [selectedCity, setSelectedCity] = useState(''); const [marketId, setMarketId] = useState(''); const [error, setError] = useState(''); const [isSaving, setIsSaving] = useState(false); const [weather, setWeather] = useState(null); const bookingsColPath = `artifacts/${appId}/public/data/bookings`; const cities = useMemo(() => [...new Set(markets.map(m => m.city))].sort(), [markets]); const filteredMarkets = useMemo(() => markets.filter(m => m.city === selectedCity).sort((a,b) => a.name.localeCompare(b.name)), [markets, selectedCity]); useEffect(() => { if (booking) { const m = markets.find(m=>m.id === booking.marketId); if(m){setSelectedCity(m.city); setMarketId(m.id);} } else if (cities.length > 0) { setSelectedCity(cities[0]);} }, [booking, markets, cities]); useEffect(() => { if (selectedCity && filteredMarkets.length > 0 && (!booking || markets.find(m => m.id === booking.marketId)?.city !== selectedCity)) { setMarketId(filteredMarkets[0].id);}}, [selectedCity, filteredMarkets, booking, markets]); useEffect(() => { const fetchWeather = async () => { if (!selectedCity || !date) { setWeather(null); return; } setWeather({loading: true}); try { const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-091?Authorization=${cwaApiKey}&locationName=${encodeURIComponent(selectedCity)}&elementName=PoP12h,Wx,MinT,MaxT`; const response = await fetch(url); if (!response.ok) throw new Error("無法取得天氣資料"); const data = await response.json(); if (data.records.locations[0].location.length === 0) { setWeather({error: "氣象署無此縣市資料"}); return; } const weatherElements = data.records.locations[0].location[0].weatherElement; const pop = weatherElements.find(e => e.elementName === 'PoP12h').time; const wx = weatherElements.find(e => e.elementName === 'Wx').time; const minT = weatherElements.find(e => e.elementName === 'MinT').time; const maxT = weatherElements.find(e => e.elementName === 'MaxT').time; const forecastDate = new Date(date); const now = new Date(); let relevantPop = 'N/A'; let relevantWx = 'N/A'; let relevantMinT = 'N/A'; let relevantMaxT = 'N/A'; for (let i = 0; i < pop.length; i++) { const startTime = new Date(pop[i].startTime); const endTime = new Date(pop[i].endTime); if (forecastDate >= startTime && forecastDate < endTime) { if (startTime.getHours() === 6 || startTime.getHours() === 18) { relevantPop = pop[i].elementValue[0].value; relevantWx = wx[i].elementValue[0].value; relevantMinT = minT[i].elementValue[0].value; relevantMaxT = maxT[i].elementValue[0].value; break; } } } setWeather({ rain: Number(relevantPop), tempMin: Number(relevantMinT), tempMax: Number(relevantMaxT), desc: relevantWx }); } catch(e) { setWeather({error: e.message}); } }; fetchWeather(); }, [selectedCity, date]); const handleSubmit = async (e) => { e.preventDefault(); setError(''); if (!marketId) { return setError('請選擇一個市場！'); } const targetDate = new Date(date); const sevenDays = 7 * 24 * 60 * 60 * 1000; const conflict = allBookings.some(b => b.marketId === marketId && (!booking || b.id !== booking.id) && Math.abs(targetDate.getTime() - new Date(b.date).getTime()) < sevenDays); if (conflict) { return setError("錯誤：一週內已有攤主登記此市場！"); } setIsSaving(true); const marketDetails = markets.find(m => m.id === marketId); const data = { date, marketId, marketName: marketDetails.name, marketCity: marketDetails.city, vendorId: currentUser.id, vendorName: currentUser.name, updatedAt: serverTimestamp(), }; try { if (booking) { await updateDoc(doc(db, bookingsColPath, booking.id), data); } else { await addDoc(collection(db, bookingsColPath), { ...data, createdAt: serverTimestamp() }); } onClose(); } catch (err) { setError("儲存失敗：" + err.message); } finally { setIsSaving(false); } }; const handleDelete = async () => { if (!booking) return; setConfirmation({ isOpen: true, title: '刪除登記', message: `您確定要刪除 ${date} 在 ${booking.marketName} 的登記嗎？`, onConfirm: async () => { setIsSaving(true); try { await deleteDoc(doc(db, bookingsColPath, booking.id)); onClose(); } catch (err) { setError("刪除失敗：" + err.message); } finally { setIsSaving(false); } } }); }; return ( <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50" onClick={onClose}> <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6" onClick={e => e.stopPropagation()}> <h2 className="text-2xl font-bold mb-4">{booking ? '編輯' : '新增'}擺攤登記</h2> <p className="text-lg mb-6 font-semibold text-blue-600">{date}</p> <form onSubmit={handleSubmit} className="space-y-4"> <div> <label className="block text-md font-medium text-gray-700 mb-2">1. 選擇市場</label> <div className="flex gap-2"> <select value={selectedCity} onChange={e => setSelectedCity(e.target.value)} className="w-1/3 p-3 border rounded-lg"><option value="">選縣市</option>{cities.map(city => <option key={city} value={city}>{city}</option>)}</select> <select value={marketId} onChange={e => setMarketId(e.target.value)} className="w-2/3 p-3 border rounded-lg">{filteredMarkets.map(market => <option key={market.id} value={market.id}>{market.name}</option>)}</select> </div> </div> {weather && (<div className="p-3 rounded-lg text-sm "><h4 className="font-semibold mb-1">天氣預報 (上午/下午)</h4>{weather.loading ? <p>查詢中...</p> : weather.error ? <p className="text-red-500">{weather.error}</p> : <div className={`p-2 rounded ${weather.rain > 30 ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>{weather.rain > 30 && <strong className="font-bold">注意！</strong>} {weather.desc}，溫度 {weather.tempMin}°~{weather.tempMax}°C，降雨機率 {weather.rain}%</div>}</div>)} {error && <p className="text-red-600 bg-red-100 p-3 rounded-lg">{error}</p>} <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t"> <button type="submit" disabled={isSaving} className="w-full flex-1 bg-blue-600 text-white font-bold py-3 rounded-lg">{isSaving ? '儲存中...' : '儲存'}</button> {booking && <button type="button" onClick={handleDelete} disabled={isSaving} className="w-full flex-1 bg-red-600 text-white font-bold py-3 rounded-lg">刪除</button>} <button type="button" onClick={onClose} className="w-full sm:w-auto bg-gray-200 text-gray-800 font-bold py-3 px-4 rounded-lg">取消</button> </div> </form> </div> </div> ); };
const ConfirmationModal = ({ config, onClose }) => { const { isOpen, title, message, onConfirm } = config; if (!isOpen) return null; return (<div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-[60]"><div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 text-center"><h3 className="text-xl font-bold text-gray-900 mb-2">{title}</h3><p className="text-gray-600 mb-6">{message}</p><div className="flex justify-center gap-4"><button onClick={onClose} className="bg-gray-200 text-gray-800 font-bold py-2 px-6 rounded-lg">取消</button><button onClick={() => { onConfirm(); onClose(); }} className="bg-red-600 text-white font-bold py-2 px-6 rounded-lg">確定</button></div></div></div>); };
const GeminiModal = ({ config, onClose }) => { const { isOpen, isLoading, content, error } = config; if (!isOpen) return null; const handleCopy = () => { if(content) { navigator.clipboard.writeText(content).then(() => alert('文案已複製！')).catch(err => alert('複製失敗')); } }; return ( <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-[60]"> <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6"> <div className="flex justify-between items-center mb-4"> <h3 className="text-xl font-bold">✨ AI 小助理</h3> <button onClick={onClose} className="text-2xl">&times;</button> </div> <div className="bg-gray-50 p-4 rounded-lg min-h-[200px] max-h-[40vh] overflow-y-auto"> {isLoading ? <p>AI思考中...</p> : error ? <p className="text-red-500">{error}</p> : <p className="whitespace-pre-wrap">{content}</p>} </div> <div className="mt-6 flex gap-4"> <button onClick={handleCopy} disabled={!content || isLoading} className="flex-1 bg-blue-600 text-white font-bold py-2 rounded-lg">複製</button> <button onClick={onClose} className="flex-1 bg-gray-200 font-bold py-2 rounded-lg">關閉</button> </div> </div> </div> ); };
async function callGeminiAPI(prompt, setGeminiModal) { setGeminiModal({ isOpen: true, isLoading: true, content: '', error: '' }); const apiKey = geminiApiKey; if (!apiKey && !isDevEnv) { setGeminiModal({ isOpen: true, isLoading: false, content: '', error: 'Gemini API 金鑰未設定。' }); return; } const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`; const payload = { contents: [{ role: "user", parts: [{ text: prompt }] }] }; try { const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const result = await response.json(); if (!response.ok) throw new Error(result?.error?.message || `API 請求失敗: ${response.status}`); const text = result.candidates?.[0]?.content?.parts?.[0]?.text; if (text) { setGeminiModal({ isOpen: true, isLoading: false, content: text, error: '' }); } else { throw new Error("從 API 收到的回應格式無效"); } } catch (error) { setGeminiModal({ isOpen: true, isLoading: false, content: '', error: `AI 功能暫時無法使用：${error.message}` }); } }

export default App;
