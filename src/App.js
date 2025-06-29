import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, serverTimestamp, query, writeBatch, getDocs, setDoc, where, orderBy, limit } from 'firebase/firestore';

// --- Firebase & API 設定 (安全版) ---
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
  geminiApiKey = ""; 
} else {
  firebaseConfig = JSON.parse(process.env.REACT_APP_FIREBASE_CONFIG || '{}');
  appId = process.env.REACT_APP_APP_ID || 'default-app-id';
  initialAuthToken = process.env.REACT_APP_INITIAL_AUTH_TOKEN || '';
  geminiApiKey = process.env.REACT_APP_GEMINI_API_KEY || ''; 
}

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
                    if (user) {
                      setIsAuthReady(true);
                    } else {
                        try {
                           const token = initialAuthToken;
                            if (token) {
                              await signInWithCustomToken(authInstance, token);
                            } else {
                              await signInAnonymously(authInstance);
                            }
                            setIsAuthReady(true);
                        } catch (error) { 
                            console.error("Error during sign-in:", error); 
                            setIsAuthReady(false); // 登入失敗，認證未就緒
                        }
                    }
                });
            } catch (error) {
                console.error("Firebase initialization failed:", error);
                setIsAuthReady(false);
            }
        } else {
            console.warn("Firebase config is missing.");
            setIsAuthReady(false); 
        }
    }, []);
    
    // --- 手動初始化函式 ---
    const setupInitialData = async () => {
        if (!db || !isAuthReady) {
            alert("資料庫或認證尚未就緒，請稍後再試！");
            return;
        }
        const vendorsRef = collection(db, `artifacts/${appId}/public/data/vendors`);
        const marketsRef = collection(db, `artifacts/${appId}/public/data/markets`);
        try {
            console.log("Forcing initial data setup...");
            alert("正在強制初始化資料，請稍候...");
            const batch = writeBatch(db);
            batch.set(doc(vendorsRef, 'sd'), { name: '德', isAdmin: true, password: '123' }); 
            batch.set(doc(vendorsRef, 'vendor-a'), { name: '夥伴A', isAdmin: false, password: '123' });
            batch.set(doc(marketsRef, 'market1'), { city: '彰化縣', name: '和美市場' });
            await batch.commit();
            alert("初始化成功！現在可以用 sd / 123 登入。");
            window.location.reload(); // 重新整理頁面以確保資料載入
        } catch (error) {
            console.error("Forced initialization failed:", error);
            alert("初始化失敗：" + error.message);
        }
    };

    // --- 資料庫讀取 & 初始化 ---
    useEffect(() => {
        if (!isAuthReady || !db) return;
        
        const vendorsRef = collection(db, `artifacts/${appId}/public/data/vendors`);
        const checkAndSetup = async () => {
            const snapshot = await getDocs(query(vendorsRef, limit(1)));
            if (snapshot.empty) {
                console.log("Vendors collection is empty, suggesting initialization.");
            }
        };
        checkAndSetup();
        
        const unsubscribes = [
            onSnapshot(collection(db, `artifacts/${appId}/public/data/vendors`), (s) => {
                const fetchedVendors = s.docs.map(d => ({ id: d.id, ...d.data() }));
                setVendors(fetchedVendors);
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
        
        const timer = setTimeout(() => setIsLoading(false), 2000); // 延長一點載入時間
        
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
                
                {!currentUser && vendors.length === 0 && <ForceInitButton onInit={setupInitialData} isReady={isAuthReady} />}

                {(isLoading) ? (
                     <div className="text-center p-10 text-gray-500">
                        <p>系統資料載入中，請稍候...</p>
                    </div>
                ) : (
                    <>
                        {currentUser && <Announcements announcements={announcements} />}
                        {currentUser && <SmartSuggestions currentUser={currentUser} bookings={bookings} markets={markets} />}
                        <CalendarGrid currentDate={currentDate} setCurrentDate={setCurrentDate} bookings={bookings} onDayClick={handleDayClick} />
                        {currentUser?.isAdmin && <AdminPanel db={db} vendors={vendors} bookings={bookings} markets={markets} announcements={announcements} setConfirmation={setConfirmation} setResetPasswordModal={setResetPasswordModal} />}
                    </>
                )}
            </div>
        </div>
        {loginModal.isOpen && <LoginModal onClose={() => setLoginModal({ isOpen: false })} vendors={vendors} onLoginSuccess={handleLoginSuccess} db={db} />}
        {accountModal.isOpen && currentUser && <AccountModal onClose={() => setAccountModal({ isOpen: false })} currentUser={currentUser} bookings={bookings} db={db} />}
        {resetPasswordModal.isOpen && <ResetPasswordModal config={resetPasswordModal} onClose={() => setResetPasswordModal({ isOpen: false, vendor: null })} db={db} />}
        {dayDetail.isOpen && <DayDetailModal detail={dayDetail} onClose={() => setDayDetail({isOpen: false, date: null})} bookings={bookings} vendors={vendors} currentUser={currentUser} onAddBooking={openBookingModal} onEditBooking={openBookingModal} setGeminiModal={setGeminiModal} db={db} />}
        {bookingModal.isOpen && <BookingModal config={bookingModal} onClose={() => setBookingModal({isOpen: false, date:null, booking:null})} currentUser={currentUser} allBookings={bookings} markets={markets} db={db} setConfirmation={setConfirmation} />}
        <ConfirmationModal config={confirmation} onClose={() => setConfirmation({ ...confirmation, isOpen: false })} />
        <GeminiModal config={geminiModal} onClose={() => setGeminiModal({ ...geminiModal, isOpen: false })} />
      </>
    );
};

// --- 強制初始化按鈕元件 ---
const ForceInitButton = ({ onInit, isReady }) => {
    return (
        <div className="my-4 p-4 border-2 border-dashed border-red-400 bg-red-50 rounded-lg text-center">
            <p className="text-red-700 font-semibold mb-2">
                如果無法登入或系統顯示異常，請點擊此按鈕進行強制初始化。
            </p>
            <button
                onClick={onInit}
                disabled={!isReady}
                className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
                {isReady ? '強制初始化系統資料' : '正在準備中...'}
            </button>
        </div>
    );
};

// --- 其他子元件 (維持不變) ---
const Announcements = ({ announcements }) => {
    const limitedAnnouncements = announcements.slice(0, 1);
    if (limitedAnnouncements.length === 0) return null;
    return (
        <div className="mb-4 bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 p-4 rounded-r-md" role="alert">
            <p className="font-bold">最新公告</p>
            <p className="text-sm">{limitedAnnouncements[0].content}</p>
        </div>
    );
}
const Header = ({ currentUser, onLogout, onLoginClick, onAccountClick }) => ( <header className="flex justify-between items-center mb-4 pb-4 border-b"> <h1 className="text-xl sm:text-2xl font-bold text-gray-900">童顏家攤位行事曆</h1> {currentUser ? ( <div className="flex items-center gap-2"> <p className="text-sm text-gray-600 hidden sm:block">歡迎, {currentUser.name}</p> <p className="text-sm font-semibold text-gray-800">({currentUser.id})</p> <button onClick={onAccountClick} className="text-xs bg-gray-500 hover:bg-gray-600 text-white font-semibold py-1 px-2 rounded-md transition">我的帳號</button> <button onClick={onLogout} className="text-xs bg-red-500 hover:bg-red-600 text-white font-semibold py-1 px-2 rounded-md transition">登出</button> </div> ) : ( <button onClick={onLoginClick} className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg">登入</button> )} </header> );
const SmartSuggestions = ({ currentUser, bookings, markets }) => { 
    const suggestions = useMemo(() => {
        if (!currentUser || markets.length === 0) return [];
        const twoWeeksAgo = new Date();
        twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
        const marketStats = bookings.reduce((acc, b) => {
            if (!acc[b.marketId]) {
                acc[b.marketId] = { sales: 0, count: 0, lastBooked: null };
            }
            acc[b.marketId].sales += b.salesQuantity || 0;
            acc[b.marketId].count++;
            const bookingDate = new Date(b.date);
            if (!acc[b.marketId].lastBooked || bookingDate > acc[b.marketId].lastBooked) {
                acc[b.marketId].lastBooked = bookingDate;
            }
            return acc;
        }, {});
        const potentialMarkets = markets
            .filter(m => !marketStats[m.id] || marketStats[m.id].lastBooked < twoWeeksAgo)
            .map(m => ({ ...m, sales: marketStats[m.id]?.sales || 0, count: marketStats[m.id]?.count || 0 }));
        if (potentialMarkets.length === 0) return [];
        potentialMarkets.sort((a, b) => {
            if (b.sales !== a.sales) return b.sales - a.sales;
            return b.count - a.count;
        });
        return potentialMarkets.slice(0, 5);
    }, [currentUser, bookings, markets]);
    return ( <div className="mb-4"> <h3 className="text-md font-bold text-gray-800 mb-2">💡 智慧推薦</h3> <div className="flex flex-wrap gap-2"> {suggestions.length > 0 ? suggestions.map(s => (<div key={s.id} className="p-2 bg-indigo-100 rounded-lg text-sm"><p className="font-bold text-indigo-800">{s.name}</p></div>)) : <p className="text-sm text-gray-500">暫無推薦，所有市場近期都很活躍喔！</p>} </div> </div> ); 
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
                    const year = date.getFullYear();
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const dayOfMonth = String(date.getDate()).padStart(2, '0');
                    const dateStr = `${year}-${month}-${dayOfMonth}`;
                    const dayBookings = bookings.filter(b => b.date === dateStr);
                    return (
                        <div key={dayNumber} onClick={() => onDayClick(dateStr)} className="h-20 sm:h-24 border border-gray-200 rounded-md p-1 flex flex-col cursor-pointer hover:bg-blue-50 transition-colors">
                            <span className="font-medium text-sm self-center sm:self-start">{dayNumber}</span>
                            <div className="flex-grow overflow-hidden text-xs space-y-0.5 mt-1">
                                {dayBookings.map(b => (
                                    <div key={b.id} className="px-1 rounded bg-green-100 text-green-800 font-semibold">{b.marketName}{b.remark && '*'}</div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
const SalesInput = ({ booking, db, onSaveSuccess }) => {
    const [sales, setSales] = useState(booking.salesQuantity || '');
    const handleSave = async () => {
        const bookingRef = doc(db, `artifacts/${appId}/public/data/bookings`, booking.id);
        await updateDoc(bookingRef, { salesQuantity: Number(sales) || 0 });
        if(onSaveSuccess) onSaveSuccess();
    };
    return (
        <div className="mt-2 flex gap-2">
            <input type="number" value={sales} onChange={e => setSales(e.target.value)} placeholder="銷售數量" className="w-full p-1 border rounded" autoFocus/>
            <button onClick={handleSave} className="bg-blue-500 text-white text-xs px-3 rounded hover:bg-blue-600">儲存</button>
        </div>
    )
};
const DayDetailModal = ({ detail, onClose, bookings, vendors, currentUser, onAddBooking, onEditBooking, setGeminiModal, db }) => { 
    if (!detail.isOpen) return null; 
    const dayBookings = bookings.filter(b => b.date === detail.date).sort((a,b) => a.marketName.localeCompare(b.name)); 
    const vendorMap = new Map(vendors.map(v => [v.id, v.name])); 
    const handleGeneratePromoText = (booking) => { const prompt = `請為「童顏家」產生一篇熱情有活力的社群媒體宣傳短文，用於宣傳擺攤活動。- 活動日期: ${booking.date} - 活動地點: ${booking.marketCity} ${booking.marketName} - 品牌與產品: 童顏家，專注於最新潮流的女鞋、女裝及時尚配件。- 風格要求: 親切、活潑、吸引人，結尾要包含行動呼籲 (例如：快來找我們尋寶！)。- 重要: 文案中請不要提及任何夥伴個人姓名。- 請使用繁體中文，並適度加入生動的表情符號 (emoji)。`; callGeminiAPI(prompt, setGeminiModal); }; 
    return ( 
        <div className="fixed inset-0 bg-black/80 flex flex-col z-40 sm:p-4" onClick={onClose}> 
            <div className="bg-gray-900 text-white w-full sm:max-w-md sm:mx-auto sm:rounded-xl flex-grow flex flex-col p-4" onClick={e => e.stopPropagation()}> 
                <div className="flex justify-between items-center mb-4 flex-shrink-0">
                    <h3 className="text-xl font-bold">{detail.date}</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-white text-3xl">&times;</button>
                </div> 
                <div className="flex-grow overflow-y-auto space-y-3">
                    {dayBookings.length > 0 ? dayBookings.map(b => ( 
                        <div key={b.id} className="p-3 bg-gray-800 rounded-lg"> 
                            <div className="flex justify-between items-center"> 
                                <div>
                                    <p className="font-bold text-lg">{b.marketName}</p>
                                    {b.remark && <p className="text-sm text-yellow-400 mt-1">備註: {b.remark}</p>}
                                </div>
                                <div className="flex items-center gap-2">
                                    {currentUser && <p className="text-sm text-gray-400">{vendorMap.get(b.vendorId) || '未知'}</p>}
                                    {currentUser?.id === b.vendorId && <button onClick={() => onEditBooking(detail.date, b)} className="bg-blue-500 text-white text-xs font-semibold py-1 px-2 rounded-md hover:bg-blue-600">編輯</button>}
                                </div>
                            </div> 
                            {currentUser?.id === b.vendorId && (
                                <div className="mt-2 space-y-2"> 
                                    <SalesInput booking={b} db={db} onSaveSuccess={onClose} />
                                    <button onClick={() => handleGeneratePromoText(b)} className="w-full text-sm bg-purple-500 hover:bg-purple-600 text-white font-semibold py-1 px-2 rounded-md">✨ 產生宣傳文案</button> 
                                </div>
                            )} 
                        </div> 
                    )) : <p className="text-gray-400 text-center py-10">本日尚無登記。</p>}
                </div> 
                {currentUser && <button onClick={() => onAddBooking(detail.date)} className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-3 rounded-lg mt-4 flex-shrink-0">新增此日登記</button>} 
            </div> 
        </div> 
    ); 
};
const AdminPanel = ({ db, vendors, markets, announcements, setConfirmation, setResetPasswordModal }) => {
    const [newVendorId, setNewVendorId] = useState('');
    const [newVendorName, setNewVendorName] = useState('');
    const [newVendorPassword, setNewVendorPassword] = useState('');
    const [isNewVendorAdmin, setIsNewVendorAdmin] = useState(false);
    const [vendorError, setVendorError] = useState('');
    const [newMarketCity, setNewMarketCity] = useState(TAIWAN_CITIES[0]);
    const [newMarketName, setNewMarketName] = useState('');
    const [marketError, setMarketError] = useState('');
    const [newAnnouncement, setNewAnnouncement] = useState('');
    const [announcementError, setAnnouncementError] = useState('');
    const [editingMarket, setEditingMarket] = useState(null);
    const [editingVendor, setEditingVendor] = useState(null);
    const [editingAnnouncement, setEditingAnnouncement] = useState(null);
    const vendorsColPath = `artifacts/${appId}/public/data/vendors`;
    const marketsColPath = `artifacts/${appId}/public/data/markets`;
    const announcementsColPath = `artifacts/${appId}/public/data/announcements`;
    const handleAddVendor = async (e) => { e.preventDefault(); setVendorError(''); if (!newVendorId || !newVendorName || !newVendorPassword) { return setVendorError('編號、名稱和密碼不可為空！'); } if (vendors.some(v => v.id.toLowerCase() === newVendorId.toLowerCase())) { return setVendorError('此編號已存在！'); } try { await setDoc(doc(db, vendorsColPath, newVendorId), { name: newVendorName, isAdmin: isNewVendorAdmin, password: newVendorPassword }); setNewVendorId(''); setNewVendorName(''); setNewVendorPassword(''); setIsNewVendorAdmin(false); } catch (err) { setVendorError('新增失敗：' + err.message); } };
    const handleDeleteVendor = async (vendorId) => { try { await deleteDoc(doc(db, vendorsColPath, vendorId)); } catch (err) { alert('刪除失敗：' + err.message); } };
    const handleUpdateVendor = async () => { if (!editingVendor || !editingVendor.name) { return alert('夥伴名稱不可為空！'); } try { const vendorRef = doc(db, vendorsColPath, editingVendor.id); await updateDoc(vendorRef, { name: editingVendor.name, isAdmin: editingVendor.isAdmin }); setEditingVendor(null); } catch (err) { alert('更新夥伴失敗: ' + err.message); } };
    const handleAddNewMarket = async (e) => { e.preventDefault(); setMarketError(''); if (!newMarketCity || !newMarketName) { return setMarketError('縣市和市場名稱不可為空！'); } try { await addDoc(collection(db, marketsColPath), { city: newMarketCity, name: newMarketName }); setNewMarketCity(TAIWAN_CITIES[0]); setNewMarketName(''); } catch (err) { setMarketError('新增市場失敗: ' + err.message); } };
    const handleUpdateMarket = async () => { if (!editingMarket || !editingMarket.city || !editingMarket.name) { return alert('縣市和市場名稱不可為空！'); } try { const marketRef = doc(db, marketsColPath, editingMarket.id); await updateDoc(marketRef, { city: editingMarket.city, name: editingMarket.name }); setEditingMarket(null); } catch (err) { alert('更新失敗: ' + err.message); } };
    const handleDeleteMarket = (market) => { setConfirmation({ isOpen: true, title: '刪除市場', message: `確定要刪除「${market.name}」嗎？`, onConfirm: async () => { try { await deleteDoc(doc(db, marketsColPath, market.id)); } catch (err) { alert('刪除失敗: ' + err.message); } } }); };
    const handlePostAnnouncement = async (e) => { e.preventDefault(); setAnnouncementError(''); if (!newAnnouncement.trim()) { return setAnnouncementError('公告內容不可為空！'); } try { await addDoc(collection(db, announcementsColPath), { content: newAnnouncement, createdAt: serverTimestamp() }); setNewAnnouncement(''); } catch (err) { setAnnouncementError('發布失敗: ' + err.message); } };
    const handleUpdateAnnouncement = async () => { if (!editingAnnouncement || !editingAnnouncement.content.trim()) return; try { await updateDoc(doc(db, announcementsColPath, editingAnnouncement.id), { content: editingAnnouncement.content }); setEditingAnnouncement(null); } catch (err) { alert('更新公告失敗: ' + err.message); } };
    const handleDeleteAnnouncement = (announcementId) => { setConfirmation({ isOpen: true, title: '刪除公告', message: '確定要刪除這則公告嗎？', onConfirm: async () => { try { await deleteDoc(doc(db, announcementsColPath, announcementId)); } catch (err) { alert('刪除公告失敗: ' + err.message); } } }); };
    const handleExport = () => { alert("匯出功能待開發！"); };
    const handleImport = (event) => { alert("匯入功能待開發！"); };
    return (
        <div className="mt-8 pt-6 border-t">
            <h3 className="text-xl font-bold text-gray-800 mb-4">👑 管理面板</h3>
            <div className="bg-gray-50 p-4 rounded-lg space-y-6">
                <details className="space-y-3">
                    <summary className="font-semibold cursor-pointer">夥伴管理</summary>
                    <form onSubmit={handleAddVendor} className="space-y-3 bg-white p-3 rounded-md border">
                        <input value={newVendorId} onChange={e => setNewVendorId(e.target.value)} placeholder="新夥伴編號" className="w-full p-2 border rounded" />
                        <input value={newVendorName} onChange={e => setNewVendorName(e.target.value)} placeholder="新夥伴名稱" className="w-full p-2 border rounded" />
                        <input value={newVendorPassword} onChange={e => setNewVendorPassword(e.target.value)} placeholder="初始密碼" className="w-full p-2 border rounded" />
                        <label className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={isNewVendorAdmin} onChange={e => setIsNewVendorAdmin(e.target.checked)} /> 設為管理員
                        </label>
                        {vendorError && <p className="text-red-500 text-sm">{vendorError}</p>}
                        <button type="submit" className="w-full bg-green-500 text-white p-2 rounded hover:bg-green-600">新增夥伴</button>
                    </form>
                    <div className="space-y-2 max-h-40 overflow-y-auto p-1">{vendors.map(v => (<div key={v.id}>{editingVendor?.id === v.id ? (<div className="p-2 bg-yellow-100 rounded border border-yellow-300 space-y-2"><input value={editingVendor.name} onChange={e => setEditingVendor({ ...editingVendor, name: e.target.value })} className="w-full p-1 border rounded" placeholder="夥伴名稱" /><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editingVendor.isAdmin} onChange={e => setEditingVendor({ ...editingVendor, isAdmin: e.target.checked })} />設為管理員</label><div className="flex gap-2"><button onClick={handleUpdateVendor} className="flex-1 text-xs bg-green-500 text-white py-1 px-2 rounded">儲存</button><button onClick={() => setEditingVendor(null)} className="flex-1 text-xs bg-gray-400 text-white py-1 px-2 rounded">取消</button></div></div>) : (<div className="flex justify-between items-center p-2 bg-white rounded border"><div><span className="font-semibold">{v.name}</span> ({v.id}) {v.isAdmin && '👑'}</div><div className="flex gap-2"><button onClick={() => setEditingVendor(v)} className="text-xs bg-blue-500 text-white py-1 px-2 rounded">編輯</button><button onClick={() => setResetPasswordModal({ isOpen: true, vendor: v })} className="text-xs bg-yellow-500 text-white py-1 px-2 rounded">重設密碼</button>{v.id !== 'sd' && <button onClick={()=>setConfirmation({ isOpen: true, title: '刪除夥伴', message: `您確定要刪除 ${v.name} (${v.id}) 嗎？`, onConfirm: () => handleDeleteVendor(v.id) })} className="text-xs bg-red-500 text-white py-1 px-2 rounded">刪除</button>}</div></div>)}</div>))}</div>
                </details>
                <details className="space-y-3">
                    <summary className="font-semibold cursor-pointer">市場管理</summary>
                    <form onSubmit={handleAddNewMarket} className="space-y-3 bg-white p-3 rounded-md border"><select value={newMarketCity} onChange={e => setNewMarketCity(e.target.value)} className="w-full p-2 border rounded">{TAIWAN_CITIES.map(c => <option key={c} value={c}>{c}</option>)}</select><input value={newMarketName} onChange={e => setNewMarketName(e.target.value)} placeholder="新市場名稱" className="w-full p-2 border rounded"/>{marketError && <p className="text-red-500 text-sm">{marketError}</p>}<button type="submit" className="w-full bg-green-500 text-white p-2 rounded hover:bg-green-600">新增市場</button></form>
                    <div className="space-y-2 max-h-40 overflow-y-auto p-1">{markets.map(m => (<div key={m.id}>{editingMarket?.id === m.id ? (<div className="p-2 bg-yellow-100 rounded border border-yellow-300 space-y-2"><select value={editingMarket.city} onChange={e => setEditingMarket({...editingMarket, city: e.target.value})} className="w-full p-1 border rounded">{TAIWAN_CITIES.map(c => <option key={c} value={c}>{c}</option>)}</select><input value={editingMarket.name} onChange={e => setEditingMarket({...editingMarket, name: e.target.value})} className="w-full p-1 border rounded" /><div className="flex gap-2"><button onClick={handleUpdateMarket} className="flex-1 text-xs bg-green-500 text-white py-1 px-2 rounded">儲存</button><button onClick={() => setEditingMarket(null)} className="flex-1 text-xs bg-gray-400 text-white py-1 px-2 rounded">取消</button></div></div>) : (<div className="flex justify-between items-center p-2 bg-white rounded border"><div><span className="font-semibold">{m.name}</span> ({m.city})</div><div className="flex gap-2"><button onClick={() => setEditingMarket(m)} className="text-xs bg-blue-500 text-white py-1 px-2 rounded">編輯</button><button onClick={() => handleDeleteMarket(m)} className="text-xs bg-red-500 text-white py-1 px-2 rounded">刪除</button></div></div>)}</div>))}</div>
                </details>
                <details className="space-y-3">
                    <summary className="font-semibold cursor-pointer">公告管理</summary>
                    <form onSubmit={handlePostAnnouncement} className="space-y-3 bg-white p-3 rounded-md border"><textarea value={newAnnouncement} onChange={e => setNewAnnouncement(e.target.value)} placeholder="輸入新公告內容..." rows="3" className="w-full p-2 border rounded"></textarea>{announcementError && <p className="text-red-500 text-sm">{announcementError}</p>}<button type="submit" className="w-full bg-purple-500 text-white p-2 rounded hover:bg-purple-600">發布新公告</button></form>
                    <div className="space-y-2 max-h-40 overflow-y-auto p-1">{announcements.map(ann => (<div key={ann.id}>{editingAnnouncement?.id === ann.id ? (<div className="p-2 bg-yellow-100 rounded border border-yellow-300 space-y-2"><textarea value={editingAnnouncement.content} onChange={e => setEditingAnnouncement({...editingAnnouncement, content: e.target.value})} rows="2" className="w-full p-1 border rounded"></textarea><div className="flex gap-2"><button onClick={handleUpdateAnnouncement} className="flex-1 text-xs bg-green-500 text-white py-1 px-2 rounded">儲存</button><button onClick={() => setEditingAnnouncement(null)} className="flex-1 text-xs bg-gray-400 text-white py-1 px-2 rounded">取消</button></div></div>) : (<div className="flex justify-between items-center p-2 bg-white rounded border"> <p className="text-sm flex-1">{ann.content}</p> <div className="flex gap-2"><button onClick={() => setEditingAnnouncement(ann)} className="text-xs bg-blue-500 text-white py-1 px-2 rounded">編輯</button><button onClick={() => handleDeleteAnnouncement(ann.id)} className="text-xs bg-red-500 text-white py-1 px-2 rounded">刪除</button></div> </div>)}</div>))}</div>
                </details>
                <details><summary className="font-semibold cursor-pointer">資料備份/還原</summary><div className="flex gap-2 mt-2"><button onClick={handleExport} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition">匯出 (CSV)</button><label className="flex-1 bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-lg transition cursor-pointer flex justify-center items-center">匯入 (CSV)<input type="file" accept=".csv" onChange={handleImport} className="hidden"/></label></div></details>
            </div>
        </div>
    );
};
const LoginModal = ({ onClose, vendors, onLoginSuccess, db }) => { const [id, setId] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const handleLogin = async () => { setError(''); const vendor = vendors.find(v => v.id.toLowerCase() === id.toLowerCase()); if (vendor) { if (vendor.password) { if (vendor.password === password) { onLoginSuccess(vendor); } else { setError('密碼錯誤！'); } } else if (password) { try { const vendorRef = doc(db, `artifacts/${appId}/public/data/vendors`, vendor.id); await updateDoc(vendorRef, { password: password }); onLoginSuccess({ ...vendor, password: password }); } catch (err) { setError('設定初始密碼失敗，請稍後再試。'); } } else { setError('請輸入您的初始密碼。'); } } else { setError('找不到此攤位編號！'); } }; return ( <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"> <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}> <h2 className="text-2xl font-bold mb-6 text-center">夥伴登入</h2> <div className="space-y-4"> <input type="text" value={id} onChange={e => setId(e.target.value)} placeholder="請輸入攤位編號" className="w-full p-3 border rounded-lg" /> <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="請輸入密碼" className="w-full p-3 border rounded-lg" /> {error && <p className="text-red-500 text-center">{error}</p>} <button onClick={handleLogin} className="w-full bg-blue-500 text-white font-bold py-3 rounded-lg">登入</button> <button onClick={onClose} className="w-full bg-gray-200 text-gray-800 font-bold py-2 rounded-lg mt-2">取消</button> </div> </div> </div> ); };
const AccountModal = ({ onClose, currentUser, db, bookings }) => { const [oldPassword, setOldPassword] = useState(''); const [newPassword, setNewPassword] = useState(''); const [confirmPassword, setConfirmPassword] = useState(''); const [error, setError] = useState(''); const [success, setSuccess] = useState(''); const [startDate, setStartDate] = useState(''); const [endDate, setEndDate] = useState(''); const [salesResult, setSalesResult] = useState(null); const handleChangePassword = async () => { setError(''); setSuccess(''); if (currentUser.password !== oldPassword) { return setError('舊密碼不正確！'); } if (!newPassword || newPassword !== confirmPassword) { return setError('新密碼不能為空，且兩次輸入必須相同！'); } try { const vendorRef = doc(db, `artifacts/${appId}/public/data/vendors`, currentUser.id); await updateDoc(vendorRef, { password: newPassword }); setSuccess('密碼更新成功！'); setOldPassword(''); setNewPassword(''); setConfirmPassword(''); } catch(err) { setError('密碼更新失敗，請稍後再試。'); } }; const calculateSales = (start, end) => { const userBookings = bookings.filter(b => b.vendorId === currentUser.id && new Date(b.date) >= start && new Date(b.date) <= end); const totalSales = userBookings.reduce((sum, b) => sum + (b.salesQuantity || 0), 0); setSalesResult(`從 ${start.toLocaleDateString()} 到 ${end.toLocaleDateString()}，總銷量為: ${totalSales} 件`); }; const handleCustomQuery = () => { if(startDate && endDate) { calculateSales(new Date(startDate), new Date(endDate)); }}; const handleThisMonthQuery = () => { const now = new Date(); const start = new Date(now.getFullYear(), now.getMonth(), 1); const end = new Date(now.getFullYear(), now.getMonth() + 1, 0); calculateSales(start, end);}; return ( <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"> <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}> <h2 className="text-2xl font-bold mb-6 text-center">我的帳號</h2> <div className="space-y-4"> <details><summary className="font-semibold cursor-pointer">修改密碼</summary><div className="pt-2 space-y-2"><input type="password" value={oldPassword} onChange={e => setOldPassword(e.target.value)} placeholder="請輸入舊密碼" className="w-full p-2 border rounded-lg" /> <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="請輸入新密碼" className="w-full p-2 border rounded-lg" /> <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="再次確認新密碼" className="w-full p-2 border rounded-lg" /> {error && <p className="text-red-500 text-center text-sm">{error}</p>} {success && <p className="text-green-500 text-center text-sm">{success}</p>} <button onClick={handleChangePassword} className="w-full bg-green-500 text-white font-bold py-2 rounded-lg">儲存新密碼</button></div></details> <details open><summary className="font-semibold cursor-pointer">業績查詢</summary><div className="pt-2 space-y-3"><div className="flex gap-2 items-center"><label className="text-sm flex-shrink-0">自訂範圍:</label><input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full p-1 border rounded-lg" /><span className="px-1">至</span><input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full p-1 border rounded-lg" /></div><button onClick={handleCustomQuery} className="w-full bg-blue-500 text-white font-bold py-2 rounded-lg">查詢自訂銷量</button><button onClick={handleThisMonthQuery} className="w-full bg-indigo-500 text-white font-bold py-2 rounded-lg mt-2">查詢本月銷量</button>{salesResult && <p className="text-center font-bold mt-3 p-2 bg-yellow-100 rounded-lg">{salesResult}</p>}</div></details> <button onClick={onClose} className="w-full bg-gray-200 text-gray-800 font-bold py-2 rounded-lg mt-4">關閉</button> </div> </div> </div> ); };
const ResetPasswordModal = ({ config, onClose, db }) => { const { vendor } = config; const [newPassword, setNewPassword] = useState(''); const [error, setError] = useState(''); const [success, setSuccess] = useState(''); const handleReset = async () => { setError(''); setSuccess(''); if (!newPassword) { return setError('新密碼不能為空！'); } try { const vendorRef = doc(db, `artifacts/${appId}/public/data/vendors`, vendor.id); await updateDoc(vendorRef, { password: newPassword }); setSuccess(`已為 ${vendor.name} 設定新密碼！`); setNewPassword(''); } catch(err) { setError('密碼重設失敗: ' + err.message); } }; return ( <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"> <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}> <h2 className="text-2xl font-bold mb-2 text-center">重設密碼</h2> <p className="text-center text-gray-600 mb-6">您正在為 {vendor.name} ({vendor.id}) 重設密碼</p> <div className="space-y-4"> <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="請輸入新密碼" className="w-full p-3 border rounded-lg" /> {error && <p className="text-red-500 text-center">{error}</p>} {success && <p className="text-green-500 text-center">{success}</p>} <button onClick={handleReset} className="w-full bg-yellow-500 text-white font-bold py-3 rounded-lg">確認重設</button> <button onClick={onClose} className="w-full bg-gray-200 text-gray-800 font-bold py-2 rounded-lg mt-2">關閉</button> </div> </div> </div> ); };
// --- AddMarketForm Sub-component ---
const AddMarketForm = ({ selectedCity, db, onMarketAdded }) => {
    const [newMarketName, setNewMarketName] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const marketsColPath = `artifacts/${appId}/public/data/markets`;
    const handleAddNewMarket = async () => {
        if (!newMarketName.trim()) {
            alert('新市場名稱不可為空！');
            return;
        }
        setIsSaving(true);
        try {
            const docRef = await addDoc(collection(db, marketsColPath), { city: selectedCity, name: newMarketName.trim() });
            onMarketAdded(docRef.id);
        } catch (err) {
            alert("新增市場失敗：" + err.message);
        } finally {
            setIsSaving(false);
        }
    };
    return (
        <div className="p-3 bg-gray-100 rounded-lg space-y-2">
            <label className="block text-md font-medium text-gray-700">在「{selectedCity}」新增市場</label>
            <div className="flex gap-2">
                <input
                    type="text"
                    value={newMarketName}
                    onChange={e => setNewMarketName(e.target.value)}
                    placeholder="輸入新市場的名稱"
                    className="w-full p-2 border rounded-lg"
                />
                <button type="button" onClick={handleAddNewMarket} disabled={isSaving} className="bg-green-500 text-white font-semibold px-4 py-2 rounded-lg whitespace-nowrap">
                    {isSaving ? '...' : '儲存'}
                </button>
            </div>
        </div>
    );
};
const BookingModal = ({ config, onClose, currentUser, allBookings, markets, db, setConfirmation }) => {
    const { date, booking } = config;
    const [selectedCity, setSelectedCity] = useState(TAIWAN_CITIES[16]);
    const [marketId, setMarketId] = useState('');
    const [remark, setRemark] = useState('');
    const [error, setError] = useState('');
    const [warning, setWarning] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [isAddingMarket, setIsAddingMarket] = useState(false);
    const bookingsColPath = `artifacts/${appId}/public/data/bookings`;
    const cities = useMemo(() => [...new Set(markets.map(m => m.city))].sort(), [markets]);
    const filteredMarkets = useMemo(() => markets.filter(m => m.city === selectedCity).sort((a, b) => a.name.localeCompare(b.name)), [markets, selectedCity]);
    useEffect(() => {
        if (booking) {
            const m = markets.find(m => m.id === booking.marketId);
            if (m) {
                setSelectedCity(m.city);
                setMarketId(m.id);
            }
            setRemark(booking.remark || '');
        } else {
            setRemark('');
            if (filteredMarkets.length > 0) {
              setMarketId(filteredMarkets[0].id);
            }
        }
    }, [booking, markets, filteredMarkets]);
    useEffect(() => {
        if (!isAddingMarket && selectedCity && filteredMarkets.length > 0) {
           setMarketId(filteredMarkets[0]?.id || '');
        }
    }, [selectedCity, filteredMarkets, isAddingMarket]);
    useEffect(() => {
        setError('');
        setWarning('');
        if (!marketId) return;
        const targetDate = new Date(date);
        const sevenDays = 7 * 24 * 60 * 60 * 1000;
        const conflict = allBookings.find(b => b.marketId === marketId && (!booking || b.id !== booking.id) && Math.abs(targetDate.getTime() - new Date(b.date).getTime()) < sevenDays);
        if (conflict) {
            setWarning(`提醒：${conflict.vendorName} 已在一週內登記此市場。`);
        }
    }, [marketId, date, allBookings, booking]);
    const handleMarketAdded = (newMarketId) => {
        setMarketId(newMarketId);
        setIsAddingMarket(false);
    };
    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        if (!marketId) {
            return setError('請選擇一個市場！');
        }
        setIsSaving(true);
        const marketDetails = markets.find(m => m.id === marketId);
        const data = {
            date,
            marketId,
            marketName: marketDetails.name,
            marketCity: marketDetails.city,
            vendorId: currentUser.id,
            vendorName: currentUser.name,
            remark: remark.trim(),
            updatedAt: serverTimestamp(),
        };
        try {
            if (booking) {
                await updateDoc(doc(db, bookingsColPath, booking.id), data);
            } else {
                await addDoc(collection(db, bookingsColPath), { ...data, createdAt: serverTimestamp() });
            }
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
                        <label className="block text-md font-medium text-gray-700 mb-1">1. 選擇市場</label>
                        <div className="flex items-center gap-2">
                            <select value={selectedCity} onChange={e => setSelectedCity(e.target.value)} className="w-1/3 p-2 border rounded-lg" disabled={isAddingMarket}>
                                {TAIWAN_CITIES.map(city => <option key={city} value={city}>{city}</option>)}
                            </select>
                            <select value={marketId} onChange={e => setMarketId(e.target.value)} className="w-2/3 p-2 border rounded-lg" disabled={isAddingMarket}>
                                <option value="">請選擇市場...</option>
                                {filteredMarkets.map(market => <option key={market.id} value={market.id}>{market.name}</option>)}
                            </select>
                        </div>
                        <div className="text-right mt-1">
                            <button type="button" onClick={() => setIsAddingMarket(!isAddingMarket)} className="text-sm text-blue-500 hover:underline">
                                {isAddingMarket ? '取消新增' : '找不到市場？點此新增'}
                            </button>
                        </div>
                    </div>
                    {isAddingMarket && <AddMarketForm selectedCity={selectedCity} db={db} onMarketAdded={handleMarketAdded} />}
                    <div style={{ opacity: isAddingMarket ? 0.5 : 1 }}>
                        <label className="block text-md font-medium text-gray-700 mb-1">2. 備註 (選填)</label>
                        <input type="text" value={remark} onChange={e => setRemark(e.target.value)} placeholder="如有特殊事項請填寫" className="w-full p-2 border rounded-lg" disabled={isAddingMarket} />
                    </div>
                    {warning && <p className="text-yellow-600 bg-yellow-100 p-3 rounded-lg text-sm">{warning}</p>}
                    {error && <p className="text-red-600 bg-red-100 p-3 rounded-lg text-sm">{error}</p>}
                    <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t">
                        <button type="submit" disabled={isSaving || isAddingMarket} className="w-full flex-1 bg-blue-600 text-white font-bold py-3 rounded-lg disabled:bg-gray-400">
                            {isSaving ? '儲存中...' : '儲存登記'}
                        </button>
                        {booking && <button type="button" onClick={handleDelete} disabled={isSaving || isAddingMarket} className="w-full flex-1 bg-red-600 text-white font-bold py-3 rounded-lg disabled:bg-gray-400">刪除</button>}
                        <button type="button" onClick={onClose} className="w-full sm:w-auto bg-gray-200 text-gray-800 font-bold py-3 px-4 rounded-lg">取消</button>
                    </div>
                </form>
            </div>
        </div>
    );
};
const ConfirmationModal = ({ config, onClose }) => { const { isOpen, title, message, onConfirm } = config; if (!isOpen) return null; return (<div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-[60]"><div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 text-center"><h3 className="text-xl font-bold text-gray-900 mb-2">{title}</h3><p className="text-gray-600 mb-6">{message}</p><div className="flex justify-center gap-4"><button onClick={onClose} className="bg-gray-200 text-gray-800 font-bold py-2 px-6 rounded-lg">取消</button><button onClick={() => { onConfirm(); onClose(); }} className="bg-red-600 text-white font-bold py-2 px-6 rounded-lg">確定</button></div></div></div>); };
const GeminiModal = ({ config, onClose }) => { const { isOpen, isLoading, content, error } = config; if (!isOpen) return null; const handleCopy = () => { if(content) { navigator.clipboard.writeText(content).then(() => alert('文案已複製！')).catch(err => alert('複製失敗')); } }; return ( <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-[60]"><div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6"> <div className="flex justify-between items-center mb-4"> <h3 className="text-xl font-bold">✨ AI 小助理</h3> <button onClick={onClose} className="text-2xl">&times;</button> </div> <div className="bg-gray-50 p-4 rounded-lg min-h-[200px] max-h-[40vh] overflow-y-auto"> {isLoading ? <p>AI思考中...</p> : error ? <p className="text-red-500">{error}</p> : <p className="whitespace-pre-wrap">{content}</p>} </div> <div className="mt-6 flex gap-4"> <button onClick={handleCopy} disabled={!content || isLoading} className="flex-1 bg-blue-600 text-white font-bold py-2 rounded-lg">複製</button> <button onClick={onClose} className="flex-1 bg-gray-200 font-bold py-2 rounded-lg">關閉</button> </div> </div> </div> ); };
async function callGeminiAPI(prompt, setGeminiModal) { setGeminiModal({ isOpen: true, isLoading: true, content: '', error: '' }); const apiKey = geminiApiKey; if (!apiKey && !isDevEnv) { setGeminiModal({ isOpen: true, isLoading: false, content: '', error: 'Gemini API 金鑰未設定。' }); return; } const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`; const payload = { contents: [{ role: "user", parts: [{ text: prompt }] }] }; try { const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const result = await response.json(); if (!response.ok) throw new Error(result?.error?.message || `API 請求失敗: ${response.status}`); const text = result.candidates?.[0]?.content?.parts?.[0]?.text; if (text) { setGeminiModal({ isOpen: true, isLoading: false, content: text, error: '' }); } else { throw new Error("從 API 收到的回應格式無效"); } } catch (error) { setGeminiModal({ isOpen: true, isLoading: false, content: '', error: `AI 功能暫時無法使用：${error.message}` }); } }

export default App;
