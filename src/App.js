import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, serverTimestamp, query, writeBatch, getDocs, setDoc, where } from 'firebase/firestore';

// --- Firebase 設定 (安全版) ---
let firebaseConfig, appId, initialAuthToken, geminiApiKey;
// eslint-disable-next-line no-undef
const isDevEnv = typeof __firebase_config !== 'undefined';

if (isDevEnv) {
  // eslint-disable-next-line no-undef
  firebaseConfig = JSON.parse(__firebase_config);
  // eslint-disable-next-line no-undef
  appId = __app_id;
  // eslint-disable-next-line no-undef
  initialAuthToken = __initial_auth_token || '';
  geminiApiKey = "AIzaSyB4iRSaKZ_n-INunHzly_Ygievf8iPJeW0"; // 在開發環境中，由平台注入
} else {
  firebaseConfig = JSON.parse(process.env.REACT_APP_FIREBASE_CONFIG || '{}');
  appId = process.env.REACT_APP_APP_ID || 'default-app-id';
  initialAuthToken = process.env.REACT_APP_INITIAL_AUTH_TOKEN || '';
  geminiApiKey = process.env.REACT_APP_GEMINI_API_KEY || ''; // 從環境變數讀取您的金鑰
}

// --- App 主元件 ---
const App = () => {
    // --- 狀態管理 (State) ---
    const [currentUser, setCurrentUser] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [vendors, setVendors] = useState([]);
    const [markets, setMarkets] = useState([]);
    const [bookings, setBookings] = useState([]);
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
                    if (savedVendor) {
                        setCurrentUser(savedVendor);
                    }
                }
            }),
            onSnapshot(collection(db, `artifacts/${appId}/public/data/markets`), (s) => setMarkets(s.docs.map(d => ({ id: d.id, ...d.data() })))),
            onSnapshot(collection(db, `artifacts/${appId}/public/data/bookings`), (s) => {
                setBookings(s.docs.map(d => ({ id: d.id, ...d.data() })));
                setIsLoading(false);
            })
        ];
        return () => unsubscribes.forEach(unsub => unsub());
    }, [isAuthReady, db]);

    // --- 事件處理函式 ---
    const handleLoginSuccess = (vendor) => {
        setCurrentUser(vendor);
        localStorage.setItem('tyjVendorId', vendor.id); // 記住登入狀態
        setLoginModal({ isOpen: false });
    };
    const handleLogout = () => {
        setCurrentUser(null);
        localStorage.removeItem('tyjVendorId'); // 清除登入狀態
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
                
                {(!isAuthReady || isLoading) && !bookings.length ? (
                     <div className="text-center p-10 text-gray-500">
                        <p>系統資料載入中，請稍候...</p>
                    </div>
                ) : (
                    <>
                        {currentUser && <SmartSuggestions currentUser={currentUser} bookings={bookings} markets={markets} />}
                        <CalendarGrid currentDate={currentDate} setCurrentDate={setCurrentDate} bookings={bookings} onDayClick={handleDayClick} />
                        {currentUser?.isAdmin && <AdminPanel db={db} vendors={vendors} bookings={bookings} setConfirmation={setConfirmation} setResetPasswordModal={setResetPasswordModal} />}
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
const Header = ({ currentUser, onLogout, onLoginClick, onAccountClick }) => (
    <header className="flex justify-between items-center mb-4 pb-4 border-b">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">童顏家攤位行事曆</h1>
        {currentUser ? (
            <div className="flex items-center gap-2">
                <p className="text-sm text-gray-600 hidden sm:block">歡迎, {currentUser.name}</p>
                <p className="text-sm font-semibold text-gray-800">({currentUser.id})</p>
                <button onClick={onAccountClick} className="text-xs bg-gray-500 hover:bg-gray-600 text-white font-semibold py-1 px-2 rounded-md transition">我的帳號</button>
                <button onClick={onLogout} className="text-xs bg-red-500 hover:bg-red-600 text-white font-semibold py-1 px-2 rounded-md transition">登出</button>
            </div>
        ) : (
            <button onClick={onLoginClick} className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg">登入</button>
        )}
    </header>
);

const SmartSuggestions = ({ currentUser, bookings, markets }) => {
    const suggestions = useMemo(() => {
        if (!currentUser || markets.length === 0) return [];
        const marketMap = new Map(markets.map(m => [m.id, m]));
        const twoWeeksAgo = new Date();
        twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

        const marketLastBooked = bookings.reduce((acc, b) => {
            if (!acc[b.marketId] || new Date(b.date) > acc[b.marketId]) { acc[b.marketId] = new Date(b.date); }
            return acc;
        }, {});
        const recentMarkets = new Set(Object.entries(marketLastBooked).filter(([, date]) => date >= twoWeeksAgo).map(([marketId]) => marketId));
        const potentialMarkets = markets.filter(m => !recentMarkets.has(m.id));
        if (potentialMarkets.length === 0) return [];

        const userBookings = bookings.filter(b => b.vendorId === currentUser.id);
        const userMarketCounts = userBookings.reduce((acc, b) => { if (potentialMarkets.some(pm => pm.id === b.marketId)) { acc[b.marketId] = (acc[b.marketId] || 0) + 1; } return acc; }, {});
        const sortedUserMarkets = Object.entries(userMarketCounts).sort(([,a],[,b]) => b - a);
        const mostVisitedId = sortedUserMarkets[0]?.[0];
        const leastVisitedId = sortedUserMarkets[sortedUserMarkets.length - 1]?.[0];

        const allMarketCounts = bookings.reduce((acc, b) => { if (potentialMarkets.some(pm => pm.id === b.marketId)) { acc[b.marketId] = (acc[b.marketId] || 0) + 1; } return acc; }, {});
        const generalTopMarkets = Object.entries(allMarketCounts).sort(([,a],[,b]) => b - a);
        
        let recs = new Map();
        if (mostVisitedId && marketMap.has(mostVisitedId)) { recs.set(mostVisitedId, { ...marketMap.get(mostVisitedId), reason: '您的熱門首選' }); }
        if (leastVisitedId && leastVisitedId !== mostVisitedId && marketMap.has(leastVisitedId)) { recs.set(leastVisitedId, { ...marketMap.get(leastVisitedId), reason: '您的潛力黑馬' }); }
        for (const [marketId] of generalTopMarkets) { if (recs.size >= 5) break; if (marketMap.has(marketId) && !recs.has(marketId)) { recs.set(marketId, { ...marketMap.get(marketId), reason: '近期整體熱門' }); } }
        return Array.from(recs.values());
    }, [currentUser, bookings, markets]);
    
    return (
        <div className="mb-4">
            <h3 className="text-md font-bold text-gray-800 mb-2">💡 智慧推薦</h3>
            <div className="flex flex-wrap gap-2">
                {suggestions.length > 0 ? suggestions.map(s => (<div key={s.id} className="p-2 bg-indigo-100 rounded-lg text-sm"><p className="font-bold text-indigo-800">{s.name}</p><p className="text-xs text-indigo-600">{s.reason}</p></div>)) : <p className="text-sm text-gray-500">暫無推薦，所有市場近期都很活躍喔！</p>}
            </div>
        </div>
    );
};

const CalendarGrid = ({ currentDate, setCurrentDate, bookings, onDayClick }) => {
    const startOfMonth = useMemo(() => new Date(currentDate.getFullYear(), currentDate.getMonth(), 1), [currentDate]);
    const endOfMonth = useMemo(() => new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0), [currentDate]);
    const startDay = useMemo(() => startOfMonth.getDay(), [startOfMonth]);
    const daysInMonth = useMemo(() => endOfMonth.getDate(), [endOfMonth]);
    
    const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
    const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
    
    return (
        <div className="mt-4">
            <div className="flex justify-between items-center mb-2">
                <button onClick={prevMonth} className="p-2 rounded-full hover:bg-gray-200"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg></button>
                <h2 className="text-lg font-bold text-gray-800">{currentDate.getFullYear()} 年 {currentDate.getMonth() + 1} 月</h2>
                <button onClick={nextMonth} className="p-2 rounded-full hover:bg-gray-200"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg></button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-gray-500 mb-1">
                {['日', '一', '二', '三', '四', '五', '六'].map(day => <div key={day} className="py-1">{day}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: startDay }).map((_, i) => <div key={`empty-${i}`}></div>)}
                {Array.from({ length: daysInMonth }).map((_, day) => {
                    const dayNumber = day + 1;
                    const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), dayNumber);
                    const dateStr = date.toISOString().slice(0,10);
                    const dayBookings = bookings.filter(b => b.date === dateStr);
                    return (
                        <div key={dayNumber} onClick={() => onDayClick(dateStr)} className="h-20 sm:h-24 border border-gray-200 rounded-md p-1 flex flex-col cursor-pointer hover:bg-blue-50 transition-colors">
                            <span className="font-medium text-sm self-center sm:self-start">{dayNumber}</span>
                            <div className="flex-grow overflow-hidden text-xs space-y-0.5 mt-1">
                                {dayBookings.map(b => (
                                    <div key={b.id} className="px-1 rounded bg-green-100 text-green-800 font-semibold truncate">{b.marketName}</div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

const DayDetailModal = ({ detail, onClose, bookings, vendors, currentUser, onAddBooking, onEditBooking, setGeminiModal }) => {
    if (!detail.isOpen) return null;
    const dayBookings = bookings.filter(b => b.date === detail.date).sort((a,b) => a.marketName.localeCompare(b.name));
    const vendorMap = new Map(vendors.map(v => [v.id, v.name]));

    const handleGeneratePromoText = (booking) => {
        const prompt = `請為「童顏家」產生一篇熱情有活力的社群媒體宣傳短文，用於宣傳擺攤活動。- 活動日期: ${booking.date} - 活動地點: ${booking.marketCity} ${booking.marketName} - 品牌與產品: 童顏家，專注於最新潮流的女鞋、女裝及時尚配件。- 風格要求: 親切、活潑、吸引人，結尾要包含行動呼籲 (例如：快來找我們尋寶！)。- 重要: 文案中請不要提及任何攤主個人姓名。- 請使用繁體中文，並適度加入生動的表情符號 (emoji)。`;
        callGeminiAPI(prompt, setGeminiModal);
    };
    
    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-40" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4"><h3 className="text-xl font-bold text-gray-800">{detail.date}</h3><button onClick={onClose} className="text-gray-500 hover:text-gray-800 text-2xl">&times;</button></div>
                <div className="space-y-3 mb-4 max-h-60 overflow-y-auto">{dayBookings.length > 0 ? dayBookings.map(b => (
                    <div key={b.id} className="p-3 bg-gray-100 rounded-lg">
                        <div className="flex justify-between items-center">
                            <div><p className="font-bold text-gray-800">{b.marketName}</p>{currentUser && <p className="text-sm text-gray-600">{vendorMap.get(b.vendorId) || '未知'}</p>}</div>
                            {currentUser?.id === b.vendorId && <button onClick={() => onEditBooking(detail.date, b)} className="bg-blue-500 text-white text-sm font-semibold py-1 px-3 rounded-md hover:bg-blue-600">編輯</button>}
                        </div>
                        {currentUser?.id === b.vendorId && <button onClick={() => handleGeneratePromoText(b)} className="mt-2 w-full text-sm bg-purple-500 hover:bg-purple-600 text-white font-semibold py-1 px-2 rounded-md">✨ 產生宣傳文案</button>}
                    </div>
                )) : <p className="text-gray-500">本日尚無登記。</p>}</div>
                {currentUser && <button onClick={() => onAddBooking(detail.date)} className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-3 rounded-lg">新增此日登記</button>}
            </div>
        </div>
    );
};

const AdminPanel = ({ db, vendors, bookings, setConfirmation, setResetPasswordModal }) => {
    const [newId, setNewId] = useState('');
    const [newName, setNewName] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [isAdmin, setIsAdmin] = useState(false);
    const [error, setError] = useState('');
    const vendorsColPath = `artifacts/${appId}/public/data/vendors`;

    const handleAddVendor = async (e) => {
        e.preventDefault(); setError('');
        if (!newId || !newName || !newPassword) { return setError('編號、名稱和密碼不可為空！'); }
        if (vendors.some(v => v.id.toLowerCase() === newId.toLowerCase())) { return setError('此編號已存在！'); }
        try {
            await setDoc(doc(db, vendorsColPath, newId), { name: newName, isAdmin, password: newPassword });
            setNewId(''); setNewName(''); setNewPassword(''); setIsAdmin(false);
        } catch (err) { setError('新增失敗：' + err.message); }
    };
    
    const handleDeleteVendor = async (vendorId) => {
      try { await deleteDoc(doc(db, vendorsColPath, vendorId)); } 
      catch(err) { alert('刪除失敗：' + err.message); }
    };

    const handleExport = () => {
        const vendorMap = new Map(vendors.map(v => [v.id, v.name]));
        let csvContent = "data:text/csv;charset=utf-8,\uFEFF";
        csvContent += "date,marketCity,marketName,vendorId,vendorName\r\n";
        const sortedBookings = [...bookings].sort((a, b) => new Date(a.date) - new Date(b.date));
        sortedBookings.forEach(b => {
            const row = [ b.date, b.marketCity || '', `"${b.marketName || ''}"`, b.vendorId, `"${vendorMap.get(b.vendorId) || b.vendorName || "未知"}"` ].join(',');
            csvContent += row + "\r\n";
        });
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `童顏家攤位預約紀錄_${new Date().toISOString().slice(0,10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleImport = (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            const text = e.target.result;
            const lines = text.split('\n').filter(line => line.trim() !== '');
            if (lines.length < 2) {
                alert('CSV檔案是空的或格式不符。');
                return;
            }
            const headers = lines[0].trim().split(',');
            const requiredHeaders = ['date', 'marketName', 'vendorId'];
            if (!requiredHeaders.every(h => headers.includes(h))) {
                alert(`CSV 檔案缺少必要的欄位，需要包含: ${requiredHeaders.join(', ')}`);
                return;
            }

            const newBookings = lines.slice(1).map(line => {
                const values = line.trim().split(',');
                const booking = headers.reduce((obj, header, index) => {
                    obj[header] = values[index]?.replace(/"/g, '') || '';
                    return obj;
                }, {});
                return booking;
            });
            
            setConfirmation({ isOpen: true, title: '確認匯入', message: `您確定要從檔案匯入 ${newBookings.length} 筆紀錄嗎？系統會自動跳過重複的資料。`, 
                onConfirm: async () => {
                    const bookingsColPath = `artifacts/${appId}/public/data/bookings`;
                    const batch = writeBatch(db);
                    let importedCount = 0;
                    for (const b of newBookings) {
                        if (!b.date || !b.marketName || !b.vendorId) continue;
                        const q = query(collection(db, bookingsColPath), where("date", "==", b.date), where("vendorId", "==", b.vendorId), where("marketName", "==", b.marketName));
                        const existing = await getDocs(q);
                        if (existing.empty) {
                           const newBookingRef = doc(collection(db, bookingsColPath));
                           batch.set(newBookingRef, {
                               date: b.date,
                               marketCity: b.marketCity || '',
                               marketName: b.marketName,
                               vendorId: b.vendorId,
                               vendorName: vendors.find(v => v.id === b.vendorId)?.name || '',
                               createdAt: serverTimestamp(),
                               updatedAt: serverTimestamp(),
                           });
                           importedCount++;
                        }
                    }
                    await batch.commit();
                    alert(`匯入完成！成功新增 ${importedCount} 筆新紀錄。`);
                }
            });
        };
        reader.readAsText(file);
        event.target.value = null; // Reset file input
    };

    return (
        <div className="mt-8 pt-6 border-t">
            <h3 className="text-xl font-bold text-gray-800 mb-4">👑 攤主管理面板</h3>
            <div className="bg-gray-50 p-4 rounded-lg space-y-4">
                <form onSubmit={handleAddVendor} className="space-y-3">
                    <h4 className="font-semibold">新增攤主</h4>
                    <input value={newId} onChange={e => setNewId(e.target.value)} placeholder="新攤主編號" className="w-full p-2 border rounded"/>
                    <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="新攤主名稱" className="w-full p-2 border rounded"/>
                    <input value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="初始密碼" className="w-full p-2 border rounded"/>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isAdmin} onChange={e => setIsAdmin(e.target.checked)} /> 設為管理員</label>
                    {error && <p className="text-red-500 text-sm">{error}</p>}
                    <button type="submit" className="w-full bg-green-500 text-white p-2 rounded hover:bg-green-600">新增攤主</button>
                </form>
                <div>
                    <h4 className="font-semibold mb-2">現有攤主列表</h4>
                    <div className="space-y-2 max-h-40 overflow-y-auto p-1">
                        {vendors.map(v => (
                            <div key={v.id} className="flex justify-between items-center p-2 bg-white rounded border">
                                <div><span className="font-semibold">{v.name}</span> ({v.id}) {v.isAdmin && '👑'}</div>
                                <div className="flex gap-2">
                                    <button onClick={() => setResetPasswordModal({ isOpen: true, vendor: v })} className="text-xs bg-yellow-500 text-white py-1 px-2 rounded">重設密碼</button>
                                    {v.id !== 'sd' && <button onClick={()=>setConfirmation({ isOpen: true, title: '刪除攤主', message: `您確定要刪除 ${v.name} (${v.id}) 嗎？`, onConfirm: () => handleDeleteVendor(v.id) })} className="text-xs bg-red-500 text-white py-1 px-2 rounded">刪除</button>}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                 <div>
                    <h4 className="font-semibold mb-2">資料備份/還原</h4>
                    <div className="flex gap-2">
                         <button onClick={handleExport} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition">匯出 (CSV)</button>
                         <label className="flex-1 bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-lg transition cursor-pointer text-center">
                            匯入 (CSV)
                            <input type="file" accept=".csv" onChange={handleImport} className="hidden"/>
                         </label>
                    </div>
                </div>
            </div>
        </div>
    );
};

const LoginModal = ({ onClose, vendors, onLoginSuccess, db }) => {
    const [id, setId] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');

    const handleLogin = async () => {
        setError('');
        const vendor = vendors.find(v => v.id.toLowerCase() === id.toLowerCase());

        if (vendor) {
            // Case 1: Existing user with password
            if (vendor.password) {
                if (vendor.password === password) {
                    onLoginSuccess(vendor);
                } else {
                    setError('密碼錯誤！');
                }
            } 
            // Case 2: Existing user WITHOUT password (first login after update)
            else if (password) {
                try {
                    const vendorRef = doc(db, `artifacts/${appId}/public/data/vendors`, vendor.id);
                    await updateDoc(vendorRef, { password: password });
                    onLoginSuccess({ ...vendor, password: password }); // Log in with the new password
                } catch (err) {
                    setError('設定初始密碼失敗，請稍後再試。');
                }
            } else {
                setError('請輸入您的初始密碼。');
            }
        } else {
            setError('找不到此攤位編號！');
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
                <h2 className="text-2xl font-bold mb-6 text-center">攤主登入</h2>
                <div className="space-y-4">
                    <input type="text" value={id} onChange={e => setId(e.target.value)} placeholder="請輸入攤位編號" className="w-full p-3 border rounded-lg" />
                    <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="請輸入密碼" className="w-full p-3 border rounded-lg" />
                    {error && <p className="text-red-500 text-center">{error}</p>}
                    <button onClick={handleLogin} className="w-full bg-blue-500 text-white font-bold py-3 rounded-lg">登入</button>
                    <button onClick={onClose} className="w-full bg-gray-200 text-gray-800 font-bold py-2 rounded-lg mt-2">取消</button>
                </div>
            </div>
        </div>
    );
};

const AccountModal = ({ onClose, currentUser, db }) => {
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const handleChangePassword = async () => {
        setError('');
        setSuccess('');
        if (currentUser.password !== oldPassword) {
            return setError('舊密碼不正確！');
        }
        if (!newPassword || newPassword !== confirmPassword) {
            return setError('新密碼不能為空，且兩次輸入必須相同！');
        }

        try {
            const vendorRef = doc(db, `artifacts/${appId}/public/data/vendors`, currentUser.id);
            await updateDoc(vendorRef, { password: newPassword });
            setSuccess('密碼更新成功！');
            setOldPassword('');
            setNewPassword('');
            setConfirmPassword('');
        } catch(err) {
            setError('密碼更新失敗，請稍後再試。');
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
                <h2 className="text-2xl font-bold mb-6 text-center">修改我的密碼</h2>
                <div className="space-y-4">
                     <input type="password" value={oldPassword} onChange={e => setOldPassword(e.target.value)} placeholder="請輸入舊密碼" className="w-full p-3 border rounded-lg" />
                     <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="請輸入新密碼" className="w-full p-3 border rounded-lg" />
                     <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="再次確認新密碼" className="w-full p-3 border rounded-lg" />
                     {error && <p className="text-red-500 text-center">{error}</p>}
                     {success && <p className="text-green-500 text-center">{success}</p>}
                     <button onClick={handleChangePassword} className="w-full bg-green-500 text-white font-bold py-3 rounded-lg">儲存新密碼</button>
                     <button onClick={onClose} className="w-full bg-gray-200 text-gray-800 font-bold py-2 rounded-lg mt-2">關閉</button>
                </div>
            </div>
        </div>
    );
};

const ResetPasswordModal = ({ config, onClose, db }) => {
    const { vendor } = config;
    const [newPassword, setNewPassword] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    
    const handleReset = async () => {
        setError('');
        setSuccess('');
        if (!newPassword) {
            return setError('新密碼不能為空！');
        }
        try {
            const vendorRef = doc(db, `artifacts/${appId}/public/data/vendors`, vendor.id);
            await updateDoc(vendorRef, { password: newPassword });
            setSuccess(`已為 ${vendor.name} 設定新密碼！`);
            setNewPassword('');
        } catch(err) {
            setError('密碼重設失敗: ' + err.message);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
                <h2 className="text-2xl font-bold mb-2 text-center">重設密碼</h2>
                <p className="text-center text-gray-600 mb-6">您正在為 {vendor.name} ({vendor.id}) 重設密碼</p>
                <div className="space-y-4">
                     <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="請輸入新密碼" className="w-full p-3 border rounded-lg" />
                     {error && <p className="text-red-500 text-center">{error}</p>}
                     {success && <p className="text-green-500 text-center">{success}</p>}
                     <button onClick={handleReset} className="w-full bg-yellow-500 text-white font-bold py-3 rounded-lg">確認重設</button>
                     <button onClick={onClose} className="w-full bg-gray-200 text-gray-800 font-bold py-2 rounded-lg mt-2">關閉</button>
                </div>
            </div>
        </div>
    );
};

const BookingModal = ({ config, onClose, currentUser, allBookings, markets, db, setConfirmation }) => {
    const { date, booking } = config;
    const [selectedCity, setSelectedCity] = useState('');
    const [marketId, setMarketId] = useState('');
    const [newMarketCity, setNewMarketCity] = useState('');
    const [newMarketName, setNewMarketName] = useState('');
    const [error, setError] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const bookingsColPath = `artifacts/${appId}/public/data/bookings`;
    const marketsColPath = `artifacts/${appId}/public/data/markets`;

    const cities = useMemo(() => [...new Set(markets.map(m => m.city))].sort(), [markets]);
    const filteredMarkets = useMemo(() => markets.filter(m => m.city === selectedCity).sort((a,b) => a.name.localeCompare(b.name)), [markets, selectedCity]);
    
    useEffect(() => { 
        if (booking) { 
            const m = markets.find(m=>m.id === booking.marketId); 
            if(m){ setSelectedCity(m.city); setMarketId(m.id); } 
        } else if (cities.length > 0) { 
            setSelectedCity(cities[0]);
        } 
    }, [booking, markets, cities]);

    useEffect(() => { 
        if (selectedCity && filteredMarkets.length > 0 && (!booking || markets.find(m => m.id === booking.marketId)?.city !== selectedCity)) { 
            setMarketId(filteredMarkets[0].id);
        }
    }, [selectedCity, filteredMarkets, booking, markets]);

    const handleAddNewMarket = async () => {
        if (!newMarketCity || !newMarketName) { return alert("新市場的縣市和名稱都必須填寫！"); }
        setIsSaving(true);
        try {
            const newMarketRef = await addDoc(collection(db, marketsColPath), { city: newMarketCity, name: newMarketName });
            setSelectedCity(newMarketCity);
            setMarketId(newMarketRef.id);
            setNewMarketCity('');
            setNewMarketName('');
        } catch (err) {
            setError("新增市場失敗：" + err.message);
        } finally {
            setIsSaving(false);
        }
    };

    const handleSubmit = async (e) => { 
        e.preventDefault(); setError(''); 
        if (!marketId) { return setError('請選擇一個市場！'); } 
        const targetDate = new Date(date); 
        const sevenDays = 7 * 24 * 60 * 60 * 1000; 
        const conflict = allBookings.some(b => b.marketId === marketId && (!booking || b.id !== booking.id) && Math.abs(targetDate.getTime() - new Date(b.date).getTime()) < sevenDays); 
        if (conflict) { return setError("錯誤：一週内已有攤主登記此市場！"); } 
        setIsSaving(true); 
        const marketDetails = markets.find(m => m.id === marketId); 
        const data = { date, marketId, marketName: marketDetails.name, marketCity: marketDetails.city, vendorId: currentUser.id, vendorName: currentUser.name, updatedAt: serverTimestamp(), }; 
        try { 
            if (booking) { await updateDoc(doc(db, bookingsColPath, booking.id), data); } 
            else { await addDoc(collection(db, bookingsColPath), { ...data, createdAt: serverTimestamp() }); } 
            onClose(); 
        } catch (err) { 
            setError("儲存失敗：" + err.message); 
        } finally { 
            setIsSaving(false); 
        } 
    };
    const handleDelete = async () => { 
        if (!booking) return; 
        setConfirmation({ 
            isOpen: true, 
            title: '刪除登記', 
            message: `您確定要刪除 ${date} 在 ${booking.marketName} 的登記嗎？`, 
            onConfirm: async () => { 
                setIsSaving(true); 
                try { 
                    await deleteDoc(doc(db, bookingsColPath, booking.id)); 
                    onClose(); 
                } catch (err) { 
                    setError("刪除失敗：" + err.message); 
                } finally { 
                    setIsSaving(false); 
                }
            } 
        });
    };
    
    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
                <h2 className="text-2xl font-bold mb-4">{booking ? '編輯' : '新增'}擺攤登記</h2>
                <p className="text-lg mb-6 font-semibold text-blue-600">{date}</p>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-md font-medium text-gray-700 mb-2">1. 選擇縣市</label>
                        <select value={selectedCity} onChange={e => setSelectedCity(e.target.value)} className="w-full p-3 border rounded-lg">
                            <option value="">請選擇縣市...</option>
                            {cities.map(city => <option key={city} value={city}>{city}</option>)}
                        </select>
                    </div>
                    {selectedCity && 
                        <div>
                            <label className="block text-md font-medium text-gray-700 mb-2">2. 選擇市場</label>
                            <select value={marketId} onChange={e => setMarketId(e.target.value)} className="w-full p-3 border rounded-lg">
                                {filteredMarkets.map(market => <option key={market.id} value={market.id}>{market.name}</option>)}
                            </select>
                        </div>
                    }
                    <div className="p-4 border-t mt-4">
                        <h4 className="font-semibold text-gray-600 mb-2">找不到市場嗎？手動新增</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <input value={newMarketCity} onChange={e => setNewMarketCity(e.target.value)} placeholder="新市場縣市" className="p-2 border rounded"/>
                            <input value={newMarketName} onChange={e => setNewMarketName(e.target.value)} placeholder="新市場名稱" className="p-2 border rounded"/>
                        </div>
                        <button type="button" onClick={handleAddNewMarket} className="w-full mt-2 bg-gray-500 text-white p-2 rounded" disabled={isSaving}>{isSaving ? '處理中...' : '新增並選用'}</button>
                    </div>
                    {error && <p className="text-red-600 bg-red-100 p-3 rounded-lg">{error}</p>}
                    <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t">
                        <button type="submit" disabled={isSaving} className="w-full flex-1 bg-blue-600 text-white font-bold py-3 rounded-lg">{isSaving ? '儲存中...' : '儲存'}</button>
                        {booking && <button type="button" onClick={handleDelete} disabled={isSaving} className="w-full flex-1 bg-red-600 text-white font-bold py-3 rounded-lg">刪除</button>}
                        <button type="button" onClick={onClose} className="w-full sm:w-auto bg-gray-200 text-gray-800 font-bold py-3 px-4 rounded-lg">取消</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const ConfirmationModal = ({ config, onClose }) => { const { isOpen, title, message, onConfirm } = config; if (!isOpen) return null; return (<div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-[60]"><div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 text-center"><h3 className="text-xl font-bold text-gray-900 mb-2">{title}</h3><p className="text-gray-600 mb-6">{message}</p><div className="flex justify-center gap-4"><button onClick={onClose} className="bg-gray-200 text-gray-800 font-bold py-2 px-6 rounded-lg">取消</button><button onClick={() => { onConfirm(); onClose(); }} className="bg-red-600 text-white font-bold py-2 px-6 rounded-lg">確定</button></div></div></div>); };

const GeminiModal = ({ config, onClose }) => {
    const { isOpen, isLoading, content, error } = config;
    if (!isOpen) return null;
    const handleCopy = () => {
        if(content) {
            navigator.clipboard.writeText(content).then(() => alert('文案已複製！')).catch(err => alert('複製失敗'));
        }
    };
    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-[60]">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-bold">✨ AI 小助理</h3>
                    <button onClick={onClose} className="text-2xl">&times;</button>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg min-h-[200px] max-h-[40vh] overflow-y-auto">
                    {isLoading ? <p>AI思考中...</p> : error ? <p className="text-red-500">{error}</p> : <p className="whitespace-pre-wrap">{content}</p>}
                </div>
                <div className="mt-6 flex gap-4">
                    <button onClick={handleCopy} disabled={!content || isLoading} className="flex-1 bg-blue-600 text-white font-bold py-2 rounded-lg">複製</button>
                    <button onClick={onClose} className="flex-1 bg-gray-200 font-bold py-2 rounded-lg">關閉</button>
                </div>
            </div>
        </div>
    );
};

async function callGeminiAPI(prompt, setGeminiModal) {
    setGeminiModal({ isOpen: true, isLoading: true, content: '', error: '' });
    const apiKey = geminiApiKey; // Use the globally defined key
    if (!apiKey && !isDevEnv) {
        setGeminiModal({ isOpen: true, isLoading: false, content: '', error: 'Gemini API 金鑰未設定。' });
        return;
    }
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const payload = { contents: [{ role: "user", parts: [{ text: prompt }] }] };
    try {
        const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const result = await response.json();
        if (!response.ok) throw new Error(result?.error?.message || `API 請求失敗: ${response.status}`);
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
            setGeminiModal({ isOpen: true, isLoading: false, content: text, error: '' });
        } else {
            throw new Error("從 API 收到的回應格式無效");
        }
    } catch (error) {
        setGeminiModal({ isOpen: true, isLoading: false, content: '', error: `AI 功能暫時無法使用：${error.message}` });
    }
}

export default App;
