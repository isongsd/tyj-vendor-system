import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, serverTimestamp, query, writeBatch, getDocs, setDoc } from 'firebase/firestore';

// --- Firebase 設定 (安全版) ---
let firebaseConfig, appId, initialAuthToken;

// eslint-disable-next-line no-undef
const isDevEnv = typeof __firebase_config !== 'undefined';

if (isDevEnv) {
  // 在開發預覽環境中，使用注入的變數
  // eslint-disable-next-line no-undef
  firebaseConfig = JSON.parse(__firebase_config);
  // eslint-disable-next-line no-undef
  appId = __app_id;
  // eslint-disable-next-line no-undef
  initialAuthToken = __initial_auth_token || '';
} else {
  // 在部署到 Netlify/Vercel 的正式環境中，使用環境變數
  firebaseConfig = JSON.parse(process.env.REACT_APP_FIREBASE_CONFIG || '{}');
  appId = process.env.REACT_APP_APP_ID || 'default-app-id';
  initialAuthToken = process.env.REACT_APP_INITIAL_AUTH_TOKEN || '';
}

// A helper component to display deployment info only in the development environment
const DeploymentInfoModal = ({ onClose }) => {
    // eslint-disable-next-line no-undef
    const devFirebaseConfig = typeof __firebase_config !== 'undefined' ? __firebase_config : null;
    // eslint-disable-next-line no-undef
    const devAppId = typeof __app_id !== 'undefined' ? __app_id : null;
    // eslint-disable-next-line no-undef
    const devAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

    if (!devFirebaseConfig) {
        return null; 
    }

    const handleCopy = (text) => {
        if (!text) return;
        const textArea = document.createElement("textarea");
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            alert('已複製到剪貼簿！');
        } catch (err) {
            console.error('Failed to copy text: ', err);
        }
        document.body.removeChild(textArea);
    };

    return (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ backgroundColor: 'white', color: 'black', padding: '25px', borderRadius: '10px', width: '90%', maxWidth: '600px', fontFamily: 'sans-serif' }}>
                <h2 style={{ marginTop: 0, color: '#0066ff', borderBottom: '2px solid #0066ff', paddingBottom: '10px' }}>獨立部署金鑰 (一次性複製)</h2>
                <p style={{ color: '#333' }}>請將以下三組金鑰複製到記事本，這是將系統發佈到您獨立網站所需的最後一步。</p>
                <div style={{ marginBottom: '15px' }}>
                    <strong style={{ color: '#333' }}>1. Firebase 設定 (管線圖)</strong>
                    <div style={{ position: 'relative', backgroundColor: '#f0f0f0', padding: '10px', borderRadius: '4px', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        {devFirebaseConfig}
                        <button onClick={() => handleCopy(devFirebaseConfig)} style={{ position: 'absolute', top: '5px', right: '5px', cursor: 'pointer', border: '1px solid #ccc', background: 'white', borderRadius: '4px', padding: '3px 8px' }}>複製</button>
                    </div>
                </div>
                <div style={{ marginBottom: '15px' }}>
                    <strong style={{ color: '#333' }}>2. App ID (權狀)</strong>
                     <div style={{ position: 'relative', backgroundColor: '#f0f0f0', padding: '10px', borderRadius: '4px', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        {devAppId}
                        <button onClick={() => handleCopy(devAppId)} style={{ position: 'absolute', top: '5px', right: '5px', cursor: 'pointer', border: '1px solid #ccc', background: 'white', borderRadius: '4px', padding: '3px 8px' }}>複製</button>
                    </div>
                </div>
                <div style={{ marginBottom: '20px' }}>
                    <strong style={{ color: '#333' }}>3. Auth Token (門禁卡)</strong>
                     <div style={{ position: 'relative', backgroundColor: '#f0f0f0', padding: '10px', borderRadius: '4px', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        {devAuthToken || '(此處為空值是正常的)'}
                        <button onClick={() => handleCopy(devAuthToken)} style={{ position: 'absolute', top: '5px', right: '5px', cursor: 'pointer', border: '1px solid #ccc', background: 'white', borderRadius: '4px', padding: '3px 8px' }}>複製</button>
                    </div>
                </div>
                <button onClick={onClose} style={{ width: '100%', padding: '12px', fontSize: '16px', fontWeight: 'bold', color: 'white', backgroundColor: '#28a745', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>我已複製完成，關閉此視窗</button>
            </div>
        </div>
    );
};


// --- App ---
const App = () => {
    const [isDevInfoModalOpen, setIsDevInfoModalOpen] = useState(true);
    // --- 狀態管理 (State) ---
    const [currentUser, setCurrentUser] = useState(null);
    const [vendorIdInput, setVendorIdInput] = useState('');
    const [loginError, setLoginError] = useState('');
    const [isAuthReady, setIsAuthReady] = useState(false);

    const [vendors, setVendors] = useState([]);
    const [markets, setMarkets] = useState([]);
    const [bookings, setBookings] = useState([]);
    
    const [currentDate, setCurrentDate] = useState(new Date());
    const [viewingDate, setViewingDate] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedDateForModal, setSelectedDateForModal] = useState(null);
    const [selectedBookingForModal, setSelectedBookingForModal] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    const [confirmation, setConfirmation] = useState({ isOpen: false, title: '', message: '', onConfirm: null });
    
    // --- Gemini AI 狀態管理 ---
    const [isGeminiModalOpen, setIsGeminiModalOpen] = useState(false);
    const [geminiContent, setGeminiContent] = useState('');
    const [isGeminiLoading, setIsGeminiLoading] = useState(false);
    const [geminiError, setGeminiError] = useState('');

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
                            if (token) {
                                await signInWithCustomToken(authInstance, token);
                            } else {
                                await signInAnonymously(authInstance);
                            }
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

    // --- 資料庫讀取 (Vendors, Markets, Bookings) ---
    useEffect(() => {
        if (!isAuthReady || !db) return;

        const vendorsRef = collection(db, `artifacts/${appId}/public/data/vendors`);

        const setupInitialData = async () => {
            try {
                const snapshot = await getDocs(query(vendorsRef));
                if (snapshot.empty) {
                    console.log("No initial data found. Setting up default admin and markets.");
                    const batch = writeBatch(db);
                    const sundaeDocRef = doc(vendorsRef, 'sd');
                    const marketsRef = collection(db, `artifacts/${appId}/public/data/markets`);
                    
                    batch.set(sundaeDocRef, { name: '順德總', isAdmin: true });
                    batch.set(doc(vendorsRef, 'vendor-a'), { name: '攤主A', isAdmin: false });
                    batch.set(doc(marketsRef, 'market1'), { city: '彰化縣', name: '和美市場' });
                    batch.set(doc(marketsRef, 'market2'), { city: '台中市', name: '向上市場' });
                    batch.set(doc(marketsRef, 'market3'), { city: '彰化縣', name: '員林第一市場' });
                    await batch.commit();
                }
            } catch (err) { console.error("Error checking for initial data:", err); }
        };

        setupInitialData();

        const unsubscribes = [
            onSnapshot(collection(db, `artifacts/${appId}/public/data/vendors`), (snapshot) => setVendors(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })))),
            onSnapshot(collection(db, `artifacts/${appId}/public/data/markets`), (snapshot) => setMarkets(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })))),
            onSnapshot(collection(db, `artifacts/${appId}/public/data/bookings`), (snapshot) => {
                setBookings(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
                setIsLoading(false);
            })
        ];

        return () => unsubscribes.forEach(unsub => unsub());
    }, [isAuthReady, db]);

    // --- Gemini AI API 呼叫函式 ---
    const callGeminiAPI = async (prompt) => {
        setGeminiContent('');
        setGeminiError('');
        setIsGeminiLoading(true);
        setIsGeminiModalOpen(true);

        const apiKey = ""; 
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
        
        const payload = { contents: [{ role: "user", parts: [{ text: prompt }] }] };

        try {
            const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            if (!response.ok) { throw new Error(`API request failed with status ${response.status}`); }
            const result = await response.json();
            if (result.candidates && result.candidates[0].content && result.candidates[0].content.parts && result.candidates[0].content.parts.length > 0) {
                setGeminiContent(result.candidates[0].content.parts[0].text);
            } else { throw new Error("Invalid response structure from API"); }
        } catch (error) {
            console.error("Gemini API call failed:", error);
            setGeminiError(`AI 功能暫時無法使用，請稍後再試。(${error.message})`);
        } finally {
            setIsGeminiLoading(false);
        }
    };
    
    // --- Gemini AI 功能觸發函式 ---
    const handleGeneratePromoText = (booking) => {
        const prompt = `請為「童顏家」的攤主「${booking.vendorName}」產生一篇熱情有活力的社群媒體宣傳短文。- 活動日期: ${booking.date} - 活動地點: ${booking.marketCity} ${booking.marketName} - 品牌特色: 童顏家專注於高品質、溫和親膚的保養品。 - 風格要求: 親切、活潑、吸引人，結尾要包含行動呼籲 (例如：快來找我們玩！)。- 請使用繁體中文，並適度加入生動的表情符號 (emoji)。`;
        callGeminiAPI(prompt);
    };

    const handleAnalyzeRecommendation = (market) => {
        const prompt = `請以專業顧問的口吻，用繁體中文簡要分析為什麼「${market.city} ${market.name}」是一個值得「童顏家」保養品品牌目前考慮去設攤的市場。請根據以下已知資訊進行分析：- 這是一個過去很受歡迎的熱門市場。- 我們團隊近期沒有安排過這個市場。請在 2-3 句話內總結推薦的核心理由。`;
        callGeminiAPI(prompt);
    };

    // --- 登入 & 登出邏輯 ---
    const handleLogin = () => {
        setLoginError('');
        const foundVendor = vendors.find(v => v.id.toLowerCase() === vendorIdInput.toLowerCase());
        if (foundVendor) {
            setCurrentUser(foundVendor);
        } else {
            setLoginError('找不到此攤位編號，請確認後再試。');
        }
    };
    const handleLogout = () => {
        setCurrentUser(null);
        setVendorIdInput('');
        setViewingDate(null);
    };

    // --- 核心商業邏輯 (智慧推薦) ---
    const smartSuggestions = useMemo(() => { if (bookings.length === 0 || markets.length === 0) return []; const marketStats = markets.reduce((acc, market) => ({ ...acc, [market.id]: { ...market, count: 0, lastBooked: null } }), {}); bookings.forEach(booking => { if (marketStats[booking.marketId]) { marketStats[booking.marketId].count++; const bookingDate = new Date(booking.date); if (!marketStats[booking.marketId].lastBooked || bookingDate > marketStats[booking.marketId].lastBooked) { marketStats[booking.marketId].lastBooked = bookingDate; } } }); const oneMonthAgo = new Date(); oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1); return Object.values(marketStats).filter(market => market.count > 0 && market.lastBooked && market.lastBooked < oneMonthAgo).sort((a, b) => a.lastBooked - b.lastBooked).slice(0, 3); }, [bookings, markets]);
    // --- 行事曆 UI 相關函式 ---
    const startOfMonth = useMemo(() => new Date(currentDate.getFullYear(), currentDate.getMonth(), 1), [currentDate]);
    const endOfMonth = useMemo(() => new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0), [currentDate]);
    const startDay = useMemo(() => startOfMonth.getDay(), [startOfMonth]);
    const daysInMonth = useMemo(() => endOfMonth.getDate(), [endOfMonth]);
    const prevMonth = () => { setViewingDate(null); setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1)); };
    const nextMonth = () => { setViewingDate(null); setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1)); };
    
    // --- 事件處理函式 ---
    const handleDayClick = (day) => { if(day === null) { setViewingDate(null); return; } const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`; setViewingDate(dateStr); };
    const handleAddBooking = () => { setSelectedDateForModal(viewingDate); setSelectedBookingForModal(null); setIsModalOpen(true); };
    const handleEditBooking = (booking) => { setSelectedDateForModal(booking.date); setSelectedBookingForModal(booking); setIsModalOpen(true); };
    const closeModal = () => { setIsModalOpen(false); setSelectedDateForModal(null); setSelectedBookingForModal(null); };
    const closeConfirmation = () => setConfirmation({ ...confirmation, isOpen: false });

    // --- 主畫面渲染 ---
    return (
      <>
        {isDevEnv && isDevInfoModalOpen && <DeploymentInfoModal onClose={() => setIsDevInfoModalOpen(false)} />}
        <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8 font-sans">
            {!isAuthReady || (isLoading && !currentUser) ? (
                 <div className="flex justify-center items-center h-screen"><div>載入中...</div></div>
            ) : !currentUser ? (
                <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4 font-sans">
                <div className="w-full max-w-md bg-white rounded-xl shadow-2xl p-8 text-center">
                    <h1 className="text-3xl font-bold text-gray-800 mb-2">童顏家攤位管理系統</h1>
                    <p className="text-gray-600 mb-8">請輸入您的攤位編號登入</p>
                    <div className="space-y-4">
                        <input type="text" value={vendorIdInput} onChange={(e) => setVendorIdInput(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && handleLogin()} placeholder="請輸入攤位編號 (e.g., sd)" className="w-full text-center p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"/>
                        {loginError && <p className="text-red-500">{loginError}</p>}
                        <button onClick={handleLogin} disabled={!isAuthReady || vendors.length === 0} className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-4 rounded-lg text-lg transition-transform transform hover:scale-105 disabled:bg-gray-400 disabled:cursor-not-allowed">
                            {isAuthReady && vendors.length > 0 ? '登入' : '系統載入中...'}
                        </button>
                    </div>
                </div>
            </div>
            ) : (
                <div className="max-w-7xl mx-auto">
                <header className="flex flex-col sm:flex-row justify-between items-center mb-6 pb-4 border-b-2 border-gray-200">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">童顏家攤位行事曆</h1>
                        <p className="text-lg text-gray-600">歡迎, {currentUser.name} (編號: {currentUser.id})</p>
                    </div>
                    <button onClick={handleLogout} className="mt-4 sm:mt-0 bg-red-500 hover:bg-red-600 text-white font-semibold py-2 px-5 rounded-lg transition duration-300">登出</button>
                </header>
                <main className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-lg">
                        <div className="flex justify-between items-center mb-4"><button onClick={prevMonth} className="p-2 rounded-full hover:bg-gray-200 transition"><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg></button><h2 className="text-2xl font-bold text-gray-800">{currentDate.getFullYear()} 年 {currentDate.getMonth() + 1} 月</h2><button onClick={nextMonth} className="p-2 rounded-full hover:bg-gray-200 transition"><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg></button></div>
                        <div className="grid grid-cols-7 gap-1 text-center font-semibold text-gray-600 mb-2">{['日', '一', '二', '三', '四', '五', '六'].map(day => <div key={day}>{day}</div>)}</div>
                        <div className="grid grid-cols-7 gap-1">
                            {Array.from({ length: startDay }).map((_, i) => <div key={`empty-${i}`} className="border rounded-lg border-gray-100"></div>)}
                            {Array.from({ length: daysInMonth }).map((_, day) => { const dayNumber = day + 1; const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`; const dayBookings = bookings.filter(b => b.date === dateStr); const isSelected = viewingDate === dateStr;
                                return (<div key={dayNumber} onClick={() => handleDayClick(dayNumber)} className={`h-28 border rounded-lg p-1.5 flex flex-col cursor-pointer transition-colors ${isSelected ? 'bg-blue-200 border-blue-400' : 'border-gray-200 hover:bg-blue-50'}`}><span className={`font-bold ${isSelected ? 'text-white' : ''}`}>{dayNumber}</span><div className="flex-grow overflow-y-auto text-xs space-y-1 mt-1">{dayBookings.slice(0, 2).map(booking => (<div key={booking.id} className={`p-1 rounded ${isSelected ? 'bg-white/80' : 'bg-blue-100'} text-blue-800 font-semibold truncate`}>{booking.marketName.substring(0, 4)}</div>))}{dayBookings.length > 2 && <div className={`text-center ${isSelected ? 'text-white' : 'text-gray-500'}`}>+ {dayBookings.length - 2}</div>}</div></div>);
                            })}
                        </div>
                    </div>
                    <div className="lg:col-span-1 space-y-8">
                        {viewingDate && (<DailyDetailView date={viewingDate} bookings={bookings} vendors={vendors} currentUser={currentUser} onClose={() => handleDayClick(null)} onAdd={handleAddBooking} onEdit={handleEditBooking} onGeneratePromo={handleGeneratePromoText} />)}
                        {currentUser.isAdmin && <AdminPanel db={db} vendors={vendors} setConfirmation={setConfirmation} bookings={bookings} markets={markets}/>}
                        <div className="bg-white p-6 rounded-xl shadow-lg">
                            <h3 className="text-xl font-bold text-gray-800 mb-4">💡 智慧推薦市場</h3>
                            {smartSuggestions.length > 0 ? (<ul className="space-y-3">{smartSuggestions.map(market => (<li key={market.id} className="p-3 bg-indigo-100 rounded-lg"><div><p className="font-bold text-indigo-800">{market.name} ({market.city})</p><p className="text-sm text-indigo-600">熱門但近期無人擺攤</p></div><button onClick={() => handleAnalyzeRecommendation(market)} className="mt-2 w-full text-sm bg-indigo-500 hover:bg-indigo-600 text-white font-semibold py-1 px-2 rounded-md transition">✨ AI分析推薦理由</button></li>))}</ul>) : (<p className="text-gray-500">暫無特別推薦。</p>)}
                        </div>
                    </div>
                </main>
            </div>
            )}
        </div>
        {isModalOpen && db && (<BookingModal db={db} currentUser={currentUser} date={selectedDateForModal} booking={selectedBookingForModal} allBookings={bookings} markets={markets} onClose={closeModal} setConfirmation={setConfirmation} />)}
        <ConfirmationModal isOpen={confirmation.isOpen} title={confirmation.title} message={confirmation.message} onConfirm={confirmation.onConfirm} onCancel={closeConfirmation} />
        <GeminiModal isOpen={isGeminiModalOpen} onClose={() => setIsGeminiModalOpen(false)} isLoading={isGeminiLoading} content={geminiContent} error={geminiError}/>
      </>
    );
};

// --- Child Components (Sub-components) ---

const DailyDetailView = ({ date, bookings, vendors, currentUser, onClose, onAdd, onEdit, onGeneratePromo }) => {
    const dayBookings = bookings.filter(b => b.date === date).sort((a,b) => a.marketName.localeCompare(b.name));
    const vendorNames = vendors.reduce((acc, v) => ({ ...acc, [v.id]: v.name }), {});

    return (
        <div className="bg-white p-6 rounded-xl shadow-lg">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold text-gray-800">{date}</h3>
                <button onClick={onClose} className="text-gray-500 hover:text-gray-800 font-bold text-2xl">&times;</button>
            </div>
            <div className="space-y-3 mb-4 max-h-60 overflow-y-auto">
                {dayBookings.length > 0 ? dayBookings.map(booking => (
                    <div key={booking.id} className="p-3 bg-gray-100 rounded-lg">
                        <div className="flex justify-between items-center">
                            <div>
                                <p className="font-bold text-gray-800">{booking.marketName}</p>
                                <p className={`text-sm ${booking.vendorId === currentUser.id ? 'text-green-600' : 'text-yellow-700'}`}>{vendorNames[booking.vendorId] || '未知攤主'}</p>
                            </div>
                            {booking.vendorId === currentUser.id && (
                                <button onClick={() => onEdit(booking)} className="bg-blue-500 text-white text-sm font-semibold py-1 px-3 rounded-md hover:bg-blue-600">編輯</button>
                            )}
                        </div>
                        {booking.vendorId === currentUser.id && (
                             <button onClick={() => onGeneratePromo(booking)} className="mt-2 w-full text-sm bg-purple-500 hover:bg-purple-600 text-white font-semibold py-1 px-2 rounded-md transition">✨ 產生宣傳文案</button>
                        )}
                    </div>
                )) : (
                    <p className="text-gray-500">本日尚無登記。</p>
                )}
            </div>
            <button onClick={onAdd} className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-3 rounded-lg transition-colors">新增此日登記</button>
        </div>
    );
};

const AdminPanel = ({ db, vendors, setConfirmation, bookings, markets }) => {
    const [newId, setNewId] = useState('');
    const [newName, setNewName] = useState('');
    const [isAdmin, setIsAdmin] = useState(false);
    const [error, setError] = useState('');
    const vendorsColPath = `artifacts/${appId}/public/data/vendors`;

    const handleAddVendor = async (e) => {
        e.preventDefault();
        setError('');
        if (!newId || !newName) { return setError('編號和名稱不可為空！'); }
        if (vendors.some(v => v.id.toLowerCase() === newId.toLowerCase())) { return setError('此編號已存在！'); }
        try {
            await setDoc(doc(db, vendorsColPath, newId), { name: newName, isAdmin });
            setNewId(''); setNewName(''); setIsAdmin(false);
        } catch (err) { setError('新增失敗：' + err.message); }
    };
    
    const handleDeleteVendor = async (vendorId) => {
      try {
          await deleteDoc(doc(db, vendorsColPath, vendorId));
      } catch(err) {
          alert('刪除失敗：' + err.message);
      }
    };

    const handleExport = () => {
        const vendorMap = new Map(vendors.map(v => [v.id, v.name]));
        let csvContent = "data:text/csv;charset=utf-8,\uFEFF";
        csvContent += "日期,縣市,市場名稱,攤主編號,攤主名稱\r\n";
        const sortedBookings = [...bookings].sort((a, b) => new Date(a.date) - new Date(b.date));
        sortedBookings.forEach(b => {
            const row = [ b.date, b.marketCity, b.marketName, b.vendorId, vendorMap.get(b.vendorId) || b.vendorName || "未知" ].join(',');
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

    return (
        <div className="bg-white p-6 rounded-xl shadow-lg">
            <h3 className="text-xl font-bold text-gray-800 mb-4">👑 攤主管理面板</h3>
            <div className="space-y-3 mb-4">
                <form onSubmit={handleAddVendor} className="space-y-3 p-3 border rounded-lg">
                    <input value={newId} onChange={e => setNewId(e.target.value)} placeholder="新攤主編號" className="w-full p-2 border rounded"/>
                    <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="新攤主名稱" className="w-full p-2 border rounded"/>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={isAdmin} onChange={e => setIsAdmin(e.target.checked)} /> 設為管理員</label>
                    {error && <p className="text-red-500 text-sm">{error}</p>}
                    <button type="submit" className="w-full bg-green-500 text-white p-2 rounded hover:bg-green-600">新增攤主</button>
                </form>
                <div className="space-y-2 max-h-40 overflow-y-auto p-1">
                    {vendors.map(v => (
                        <div key={v.id} className="flex justify-between items-center p-2 bg-gray-100 rounded">
                            <span>{v.name} ({v.id}) {v.isAdmin && '👑'}</span>
                            <button onClick={()=>setConfirmation({ isOpen: true, title: '刪除攤主', message: `您確定要刪除 ${v.name} (${v.id}) 嗎？`, onConfirm: () => handleDeleteVendor(v.id) })} className="text-red-500 hover:text-red-700 font-bold px-2">X</button>
                        </div>
                    ))}
                </div>
                <button onClick={handleExport} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition">匯出預約紀錄 (CSV)</button>
            </div>
        </div>
    );
};

const BookingModal = ({ db, currentUser, date, booking, allBookings, markets, onClose, setConfirmation }) => {
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
        if (booking && markets.length > 0) {
            const bookingMarket = markets.find(m => m.id === booking.marketId);
            if (bookingMarket) {
                setSelectedCity(bookingMarket.city);
                setMarketId(bookingMarket.id);
            }
        } else if (cities.length > 0) {
            setSelectedCity(cities[0]);
        }
    }, [booking, markets, cities]);

    useEffect(() => {
        if (selectedCity && filteredMarkets.length > 0 && (!booking || (booking && markets.find(m => m.id === booking.marketId)?.city !== selectedCity))) {
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

    const checkConflict = (checkDate, checkMarketId) => {
        const targetDate = new Date(checkDate);
        const sevenDays = 7 * 24 * 60 * 60 * 1000;
        return allBookings.some(b => {
            if (booking && b.id === booking.id) return false;
            if (b.marketId !== checkMarketId) return false;
            const bookingDate = new Date(b.date);
            const timeDiff = Math.abs(targetDate.getTime() - bookingDate.getTime());
            return timeDiff < sevenDays;
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        if (!marketId) { return setError('請選擇一個市場！'); }
        if (checkConflict(date, marketId)) { return setError("錯誤：一週內已有攤主登記此市場！"); }
        setIsSaving(true);
        const marketDetails = markets.find(m => m.id === marketId);
        const data = { date, marketId, marketName: marketDetails.name, marketCity: marketDetails.city, vendorId: currentUser.id, vendorName: currentUser.name, updatedAt: serverTimestamp() };
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
        setIsSaving(true);
        try {
            await deleteDoc(doc(db, bookingsColPath, booking.id));
            onClose();
        } catch (err) {
            setError("刪除失敗：" + err.message);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 sm:p-8 transform transition-all overflow-y-auto max-h-full">
                <h2 className="text-2xl font-bold mb-4 text-gray-900">{booking ? '編輯' : '新增'}擺攤登記</h2>
                <p className="text-lg mb-6 font-semibold text-blue-600">{date}</p>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-md font-medium text-gray-700 mb-2">1. 選擇縣市</label>
                        <select value={selectedCity} onChange={e => setSelectedCity(e.target.value)} className="w-full p-3 border border-gray-300 rounded-lg">
                            <option value="">請選擇縣市...</option>
                            {cities.map(city => <option key={city} value={city}>{city}</option>)}
                        </select>
                    </div>
                    {selectedCity && (
                        <div>
                            <label className="block text-md font-medium text-gray-700 mb-2">2. 選擇市場</label>
                            <select value={marketId} onChange={e => setMarketId(e.target.value)} className="w-full p-3 border border-gray-300 rounded-lg">
                                {filteredMarkets.length === 0 ? <option value="">此縣市尚無市場</option> : filteredMarkets.map(market => <option key={market.id} value={market.id}>{market.name}</option>)}
                            </select>
                        </div>
                    )}
                    <div className="p-4 border-t mt-4">
                        <h4 className="font-semibold text-gray-600 mb-2">找不到市場嗎？手動新增</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <input value={newMarketCity} onChange={e => setNewMarketCity(e.target.value)} placeholder="新市場縣市" className="sm:col-span-1 p-2 border rounded"/>
                            <input value={newMarketName} onChange={e => setNewMarketName(e.target.value)} placeholder="新市場名稱" className="sm:col-span-2 p-2 border rounded"/>
                        </div>
                        <button type="button" onClick={handleAddNewMarket} className="w-full mt-2 bg-gray-500 text-white p-2 rounded hover:bg-gray-600" disabled={isSaving}>{isSaving ? '處理中...' : '新增並選用此市場'}</button>
                    </div>
                    {error && <p className="text-red-600 bg-red-100 p-3 rounded-lg">{error}</p>}
                    <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t">
                        <button type="submit" disabled={isSaving} className="w-full flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition disabled:bg-gray-400">{isSaving ? '儲存中...' : '儲存登記'}</button>
                        {booking && (<button type="button" onClick={()=>setConfirmation({ isOpen: true, title: '刪除登記', message: `您確定要刪除 ${date} 在 ${booking.marketName} 的登記嗎？`, onConfirm: handleDelete })} disabled={isSaving} className="w-full flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-4 rounded-lg transition disabled:bg-gray-400">{isSaving ? '處理中...' : '刪除登記'}</button>)}
                        <button type="button" onClick={onClose} className="w-full sm:w-auto bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-3 px-4 rounded-lg transition">取消</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const GeminiModal = ({ isOpen, onClose, isLoading, content, error }) => {
    if (!isOpen) return null;
    const handleCopy = () => {
        if(content) {
            const textArea = document.createElement("textarea");
            textArea.value = content;
            document.body.appendChild(textArea);
            textArea.select();
            try {
                document.execCommand('copy');
                alert('文案已複製！');
            } catch (err) {
                console.error('Failed to copy text: ', err);
                alert('複製失敗，請手動複製。');
            }
            document.body.removeChild(textArea);
        }
    };
    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-[60]">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 transform transition-all">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-bold text-gray-900">✨ AI 小助理</h3>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-800 font-bold text-2xl">&times;</button>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg min-h-[200px] max-h-[40vh] overflow-y-auto">
                    {isLoading && (<div className="flex items-center justify-center h-full"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500"></div></div>)}
                    {error && <p className="text-red-600">{error}</p>}
                    {content && <p className="text-gray-800 whitespace-pre-wrap">{content}</p>}
                </div>
                <div className="mt-6 flex gap-4">
                    <button onClick={handleCopy} disabled={!content || isLoading} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition disabled:bg-gray-400">複製內文</button>
                    <button onClick={onClose} className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded-lg transition">關閉</button>
                </div>
            </div>
        </div>
    );
};

const ConfirmationModal = ({ isOpen, title, message, onConfirm, onCancel }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-[60]">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 text-center transform transition-all">
                <h3 className="text-xl font-bold text-gray-900 mb-2">{title}</h3>
                <p className="text-gray-600 mb-6">{message}</p>
                <div className="flex justify-center gap-4">
                    <button onClick={onCancel} className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-6 rounded-lg transition-colors">取消</button>
                    <button onClick={() => { onConfirm(); onCancel(); }} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-6 rounded-lg transition-colors">確定</button>
                </div>
            </div>
        </div>
    );
};

export default App;
