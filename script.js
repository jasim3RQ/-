// 1. إعداد الاتصال بقاعدة البيانات
const firebaseConfig = { 
    databaseURL: "https://bahraindelivery-2be5f-default-rtdb.firebaseio.com/",
    // ملاحظة: ستحتاج لإضافة apiKey و messagingSenderId هنا من إعدادات Firebase لضمان عمل الإشعارات
};

if (!firebase.apps.length) { firebase.initializeApp(firebaseConfig); }
const db = firebase.database();

// إعداد Firebase Messaging للتنبيهات أثناء غلق التطبيق
let messaging = null;
try {
    messaging = firebase.messaging();
} catch (e) {
    console.log("المتصفح لا يدعم التنبيهات أو ينقصه إعداد السيرفر.");
}

let currentPhone = ""; 
let loginAttempts = 0; // عداد محاولات تسجيل الدخول الخاطئة
const alertSound = new Audio('https://actions.google.com/sounds/v1/alarms/beep_short.ogg');

// --- [تعديل] إعداد صوت التنبيه (بوري السيارة) ونظام التكرار الخماسي ---
const hornSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2857/2857-preview.mp3');
hornSound.preload = "auto";
let hornInterval = null;

// دالة لتشغيل البوري 5 مرات متتالية
function playHornFiveTimes() {
    let count = 0;
    const playLoop = setInterval(() => {
        hornSound.currentTime = 0;
        hornSound.play().catch(e => console.log("تفاعل مع الشاشة لتفعيل الصوت"));
        count++;
        if (count >= 5) {
            clearInterval(playLoop);
        }
    }, 600); // الفاصل بين كل دقة ودقة هو 0.6 ثانية
}

// --- [إضافة جديدة] تسجيل الـ Service Worker وإذن التنبيهات ---
function setupPushNotifications() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js') // تأكد من وجود ملف sw.js في موقعك
        .then((registration) => {
            console.log('Service Worker تم تسجيله بنجاح');
            
            // طلب إذن التنبيهات
            return Notification.requestPermission();
        })
        .then((permission) => {
            if (permission === 'granted' && messaging) {
                // الحصول على Token الجهاز لإرسال التنبيهات إليه وهو مغلق
                return messaging.getToken();
            }
        })
        .then((token) => {
            if (token && currentPhone) {
                // حفظ التوكن في قاعدة البيانات لربطه بالمندوب
                db.ref('drivers/' + currentPhone).update({ fcmToken: token });
                console.log("تم تفعيل نظام التنبيهات أثناء الغلق.");
            }
        })
        .catch((err) => {
            console.log('خطأ في إعداد التنبيهات:', err);
        });
    }
}

// 2. دوال الواجهة
window.showReg = function() { 
    document.getElementById('login-form').style.display = 'none'; 
    document.getElementById('reg-form').style.display = 'block'; 
};

window.showLogin = function() { 
    document.getElementById('login-form').style.display = 'block'; 
    document.getElementById('reg-form').style.display = 'none'; 
};

// --- دالة تسجيل الدخول مع نظام الحماية ---
window.driverLogin = function() {
    const phoneInput = document.getElementById('d-phone').value.trim();
    const passInput = document.getElementById('d-pass').value.trim();
    if(!phoneInput || !passInput) return alert("يرجى إدخال البيانات");

    db.ref('drivers/' + phoneInput).once('value', snap => {
        const d = snap.val();
        
        if (!snap.exists()) {
            return alert("رقم الهاتف هذا غير مسجل لدينا");
        }

        if (d.status === "suspended") {
            return alert("هذا الحساب موقوف حالياً. يرجى التواصل مع الإدارة لتفعيل حسابك.");
        }

        if (d.pass === passInput) {
            if (d.status !== "yes" && d.status !== "active") return alert("حسابك بانتظار التفعيل");
            
            loginAttempts = 0; 
            currentPhone = phoneInput;
            document.getElementById('auth-screen').style.display = 'none';
            document.getElementById('main-app').style.display = 'block';
            document.getElementById('nav-bar').style.display = 'flex';
            document.getElementById('d-name-display').innerText = d.name;
            
            // تشغيل الدوال الأساسية
            loadOrders(); 
            loadHistory(); 
            watchWallet(); 
            watchNewOrders(); // تفعيل مراقبة الطلبات الجديدة للتنبيه الصوتي
            setupPushNotifications(); // [تعديل] تفعيل إشعارات الخلفية عند الدخول
        } else {
            loginAttempts++;
            let remaining = 6 - loginAttempts;
            
            if (loginAttempts >= 6) {
                db.ref('drivers/' + phoneInput).update({ status: "suspended" });
                alert("تم إيقاف حسابك تلقائياً بسبب إدخال كلمة السر خطأ لـ 6 محاولات. راجع الإدارة.");
                loginAttempts = 0;
            } else {
                alert(`كلمة السر غير صحيحة! تبقى لك ${remaining} محاولات قبل قفل الحساب.`);
            }
        }
    });
};

// --- [تعديل] دالة مراقبة الطلبات الجديدة وتشغيل البوري المتكرر ---
function watchNewOrders() {
    db.ref('orders').on('value', snap => {
        let hasWaitingOrder = false;

        snap.forEach(child => {
            const o = child.val();
            if (o.status === 'waiting') {
                hasWaitingOrder = true;
            }
        });

        if (hasWaitingOrder) {
            if (!hornInterval) {
                playHornFiveTimes();
                hornInterval = setInterval(() => {
                    playHornFiveTimes();
                }, 180000);
            }
        } else {
            if (hornInterval) {
                clearInterval(hornInterval);
                hornInterval = null;
            }
        }
    });
}

// --- دالة مراقبة الرصيد (المحفظة) ---
function watchWallet() {
    db.ref('drivers/' + currentPhone + '/wallet').on('value', snap => {
        const val = parseFloat(snap.val() || 0);
        const walletEl = document.getElementById('wallet-val');
        if(walletEl) {
            walletEl.innerText = val.toFixed(3) + " د.ب";
            walletEl.style.color = val < 0 ? "#ff4d4d" : "#FFD700";
        }
    });
}

// --- دالة طلب الانضمام ---
window.requestJoin = function() {
    const name = document.getElementById('reg-name').value.trim();
    const phone = document.getElementById('reg-phone').value.trim();
    const pass = document.getElementById('reg-pass').value.trim();
    
    if (!name || !phone || !pass) return alert("يرجى ملء كافة الخانات");

    db.ref('drivers/' + phone).once('value', snap => {
        if (snap.exists()) {
            alert("عذراً، هذا الرقم مسجل بالفعل!");
        } else {
            db.ref('drivers/' + phone).set({ 
                name: name, 
                phone: phone, 
                pass: pass, 
                status: "no", 
                wallet: 0,
                completedCount: 0,
                canceledCount: 0 
            }).then(() => {
                alert("تم إرسال الطلب بنجاح!"); 
                window.showLogin();
            });
        }
    });
};

window.switchPage = function(p) {
    document.getElementById('page-current').style.display = (p === 'home' ? 'block' : 'none');
    document.getElementById('page-history').style.display = (p === 'history' ? 'block' : 'none');
    document.getElementById('nav-home').classList.toggle('active', p === 'home');
    document.getElementById('nav-history').classList.toggle('active', p === 'history');
};

// 3. عرض الطلبات النشطة
function loadOrders() {
    db.ref('orders').on('value', snap => {
        const list = document.getElementById('orders-list');
        if (!list) return;
        list.innerHTML = "";
        
        snap.forEach(child => {
            const o = child.val();
            const id = child.key;

            if (o.status === "waiting" || (o.driver === currentPhone && o.status !== "finished" && o.status !== "cancelled")) {
                const isAccepted = (o.driver === currentPhone);
                const isCancelReq = (o.status === "cancel_requested");
                if (isCancelReq && isAccepted) alertSound.play(); 

                const method = o.method || 'Cash';
                const deliveryFee = parseFloat(o.price || 0);
                const productPrice = parseFloat(o.collectionAmount || 0);
                
                let displayPrice = deliveryFee;
                let paymentLabel = "";
                let badgeStyle = "";
                let collectionBoxHtml = "";

                if (method === 'Benefit') {
                    displayPrice = (deliveryFee * 0.8).toFixed(3);
                    paymentLabel = "بنفت (صافي ربحك 80%)";
                    badgeStyle = "background:#eef6ff; color:#005EB8; border:1px solid #005EB8;";
                    
                    collectionBoxHtml = `
                        <div style="background: #fffbe6; border: 1px dashed #f1c40f; padding: 10px; border-radius: 8px; margin-top: 10px; text-align: center;">
                            <b style="color: #967117; font-size: 13px;">💰 استلم من الزبون (ثمن المنتج فقط):</b><br>
                            <span style="font-size: 18px; font-weight: bold; color: #333;">${productPrice.toFixed(3)} د.ب</span>
                        </div>`;
                } else {
                    displayPrice = deliveryFee.toFixed(3);
                    paymentLabel = "كاش (تحصيل يدوي)";
                    badgeStyle = "background:#fff2f2; color:#DA291C; border:1px solid #DA291C;";
                    
                    const totalCash = deliveryFee + productPrice;
                    collectionBoxHtml = `
                        <div style="background: #e8f5e9; border: 1px dashed #27ae60; padding: 10px; border-radius: 8px; margin-top: 10px; text-align: center;">
                            <b style="color: #1e7e34; font-size: 13px;">💵 استلم من الزبون (توصيل + منتج):</b><br>
                            <span style="font-size: 18px; font-weight: bold; color: #333;">${totalCash.toFixed(3)} د.ب</span>
                        </div>`;
                }

                list.innerHTML += `
                <div class="order-card" style="${isCancelReq ? 'border: 3px solid #DA291C; background: #fff8f8;' : ''}">
                    <div class="order-header">
                        <span>طلب #${id.slice(-5)} <small style="display:block; font-size:10px; padding:2px 5px; border-radius:4px; margin-top:3px; ${badgeStyle}">${paymentLabel}</small></span>
                        <span style="color:var(--bh-red)">أجرة التوصيل: ${displayPrice} د.ب</span>
                    </div>

                    ${isAccepted ? collectionBoxHtml : ''}
                    
                    <div class="location-btns">
                        <button class="btn-loc active" id="btn-p-${id}" onclick="window.showTab('${id}','p')">الاستلام</button>
                        <button class="btn-loc" id="btn-d-${id}" onclick="window.showTab('${id}','d')">التسليم</button>
                    </div>

                    <div id="box-p-${id}" class="details-box" style="display:block;">
                        <div class="info-row"><span class="info-label">المنطقة:</span> <span>${o.pArea || '-'}</span></div>
                        <div class="info-row"><span class="info-label">الموقع:</span> <a href="${o.pickup || '#'}" target="_blank" style="color:green; font-weight:bold;">فتح الخريطة 📍</a></div>
                        <div class="info-row"><span class="info-label">رابط:</span> ${o.pLink ? `<a href="${o.pLink}" target="_blank" style="color:blue; text-decoration:underline;">رابط الزبون 🔗</a>` : '<span>-</span>'}</div>
                        ${isAccepted ? `<hr><div class="info-row"><span class="info-label">الهاتف:</span> <span>${o.pPhone || o.phone || '-'}</span></div><div class="info-row"><span class="info-label">المنزل:</span> <span>${o.pHouse || '-'}</span></div><div class="info-row"><span class="info-label">الطريق:</span> <span>${o.pRoad || '-'}</span></div><div class="info-row"><span class="info-label">المجمع:</span> <span>${o.pBlock || '-'}</span></div><div class="info-row"><span class="info-label">الشقة:</span> <span>${o.pType || '-'}</span></div>` : '<p style="text-align:center; color:grey; font-size:12px; margin-top:10px;">اقبل الطلب لعرض كامل البيانات</p>'}
                    </div>

                    <div id="box-d-${id}" class="details-box" style="display:none;">
                        <div class="info-row"><span class="info-label">المنطقة:</span> <span>${o.dArea || '-'}</span></div>
                        <div class="info-row"><span class="info-label">الموقع:</span> <a href="${o.dropoff || '#'}" target="_blank" style="color:green; font-weight:bold;">فتح الخريطة 📍</a></div>
                        <div class="info-row"><span class="info-label">رابط:</span> ${o.dLink ? `<a href="${o.dLink}" target="_blank" style="color:blue; text-decoration:underline;">رابط الزبون 🔗</a>` : '<span>-</span>'}</div>
                        ${isAccepted ? `<hr><div class="info-row"><span class="info-label">الهاتف:</span> <span>${o.dPhone || '-'}</span></div><div class="info-row"><span class="info-label">المنزل:</span> <span>${o.dHouse || '-'}</span></div><div class="info-row"><span class="info-label">الطريق:</span> <span>${o.dRoad || '-'}</span></div><div class="info-row"><span class="info-label">المجمع:</span> <span>${o.dBlock || '-'}</span></div><div class="info-row"><span class="info-label">الشقة:</span> <span>${o.dType || '-'}</span></div>` : '<p style="text-align:center; color:grey; font-size:12px; margin-top:10px;">اقبل الطلب لعرض كامل البيانات</p>'}
                    </div>

                    <div style="padding:10px; display:flex; flex-direction:column; gap:8px;">
                        ${o.status === "waiting" ? `<button class="btn-red" onclick="window.acceptOrder('${id}')">قبول الطلب ✅</button>` : ''}
                        ${o.status === "accepted" ? `<button class="btn-red" style="background:var(--blue)" onclick="window.pickOrder('${id}')">تم الاستلام من المحل 📦</button>` : ''}
                        ${o.status === "picked_up" ? `<button class="btn-red" style="background:var(--success)" onclick="window.finishOrder('${id}')">تم التسليم للزبون 🏁</button>` : ''}
                        ${isAccepted ? `<button class="btn-loc" style="color:red; border-color:red" onclick="window.cancelByDriver('${id}')">إلغاء من طرفي ❌</button>` : ''}
                    </div>
                </div>`;
            }
        });
    });
}

// 4. منطق العمل
window.acceptOrder = function(id) {
    db.ref('orders').once('value', snap => {
        let active = false;
        snap.forEach(c => { if(c.val().driver === currentPhone && (c.val().status==='accepted' || c.val().status==='picked_up')) active = true; });
        if(active) return alert("لديك طلب نشط حالياً 🚫");
        if(confirm("تأكيد قبول الطلب؟")) db.ref('orders/'+id).update({ status:'accepted', driver:currentPhone, driverPhone:currentPhone });
    });
};

window.pickOrder = function(id) {
    if(confirm("هل تم استلام الطلب من المحل؟")) db.ref('orders/'+id).update({ status:'picked_up' });
};

window.finishOrder = function(id) {
    if(confirm("هل تم التسليم للزبون بنجاح؟")) {
        db.ref('orders/' + id).once('value', snap => {
            const o = snap.val();
            const price = parseFloat(o.price || 0);
            const method = o.method || 'Cash';

            db.ref('drivers/' + currentPhone).once('value', dSnap => {
                const d = dSnap.val();
                let currentWallet = parseFloat(d.wallet || 0);
                let newWallet = 0;

                if (method === 'Benefit') {
                    newWallet = currentWallet + (price * 0.80);
                } else {
                    newWallet = currentWallet - (price * 0.20);
                }

                const updates = {};
                updates['/orders/' + id + '/status'] = 'finished';
                updates['/drivers/' + currentPhone + '/wallet'] = newWallet;
                updates['/drivers/' + currentPhone + '/completedCount'] = (d.completedCount || 0) + 1;

                db.ref().update(updates).then(() => {
                    alert("تم الإتمام. رصيدك الجديد: " + newWallet.toFixed(3) + " د.ب ✅");
                });
            });
        });
    }
};

window.cancelByDriver = function(id) {
    let r = prompt("سبب الإلغاء:");
    if(r && confirm("إلغاء الطلب؟")) db.ref('orders/'+id).update({ status:'waiting', driver:null });
};

// 5. تبديل التبويبات
window.showTab = function(id, t) {
    const boxP = document.getElementById(`box-p-${id}`), boxD = document.getElementById(`box-d-${id}`);
    const btnP = document.getElementById(`btn-p-${id}`), btnD = document.getElementById(`btn-d-${id}`);

    if(t === 'p') { 
        boxP.style.display = 'block'; boxD.style.display = 'none'; 
        btnP.style.background = '#DA291C'; btnP.style.color = '#fff';
        btnD.style.background = '#fff'; btnD.style.color = '#333';
    } else { 
        boxP.style.display = 'none'; boxD.style.display = 'block'; 
        btnD.style.background = '#DA291C'; btnD.style.color = '#fff';
        btnP.style.background = '#fff'; btnP.style.color = '#333';
    }
};

// 6. عرض سجل الطلبات
function loadHistory() {
    db.ref('orders').on('value', snap => {
        const hist = document.getElementById('history-list');
        if(!hist) return; hist.innerHTML = "";
        
        let historyArray = [];
        snap.forEach(c => {
            const o = c.val();
            if(o.driver === currentPhone && (o.status === "finished" || o.status === "cancelled")) {
                o.orderKey = c.key;
                historyArray.push(o);
            }
        });

        historyArray.reverse().forEach(o => {
            let orderTimeText = "وقت غير متوفر";
            if (o.timestamp) {
                const date = new Date(o.timestamp);
                const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
                const bhDate = new Date(utc + (3600000 * 3)); 
                
                orderTimeText = bhDate.toLocaleString('en-GB', {
                    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true
                });
            }

            hist.innerHTML += `
                <div class="order-card" style="padding:15px; margin-bottom:10px; border-right: 5px solid ${o.status === 'finished' ? '#27ae60' : '#888'};">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <b style="font-size:14px;">طلب #${o.orderKey.slice(-5)}</b><br>
                            <small style="color:#666;"><i class="far fa-clock"></i> ${orderTimeText}</small>
                        </div>
                        <div style="text-align:left;">
                            <span style="color:var(--bh-red); font-weight:bold;">${o.price} د.ب</span><br>
                            <small style="color:${o.status === 'finished' ? '#27ae60' : '#888'}; font-size:11px; font-weight:bold;">
                                ${o.status === 'finished' ? 'مكتمل ✅' : 'ملغي ❌'}
                            </small>
                        </div>
                    </div>
                </div>`;
        });
    });
}

// تفعيل الصوت عند أول ضغطة للمستخدم
document.addEventListener('click', function() {
    hornSound.play().then(() => {
        hornSound.pause();
        hornSound.currentTime = 0;
    }).catch(() => {});
}, { once: true });