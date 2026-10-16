(function () {
  "use strict";

  var CONFIG = window.SF_CONFIG || {};
  var Cloud = window.SFCloud;
  var useCloud = function () { return Cloud && Cloud.enabled(); };

  var STORAGE = {
    users: "stoneforge_users_v2",
    session: "stoneforge_session_v2",
    adminSession: "stoneforge_admin_session_v1",
    posts: "stoneforge_posts_v2",
    votes: "stoneforge_votes_v2",
    newsletter: "stoneforge_newsletter_v1",
    counter: "stoneforge_waitlist_counter_v1"
  };

  var ORION_LINES = [
    { ticker: "NVDA", reason: "NVDA cleared momentum 0.85 on 2.1× volume", path: "M2 42 C18 40, 28 28, 42 30 S68 48, 84 36 S112 12, 128 18 S156 44, 172 32 S204 8, 238 14" },
    { ticker: "AAPL", reason: "AAPL held VWAP on 1.4× volume into the close", path: "M2 36 C22 38, 34 22, 52 24 S84 46, 102 34 S130 10, 148 16 S180 40, 198 28 S220 18, 238 22" },
    { ticker: "MSFT", reason: "MSFT breakout retest held; relative strength 1.3× peers", path: "M2 44 C20 42, 30 34, 48 32 S78 40, 96 28 S124 8, 142 14 S170 36, 188 26 S214 12, 238 16" },
    { ticker: "META", reason: "META compression unwind — range 0.4 ATR, volume woke up", path: "M2 30 C18 34, 32 44, 48 40 S76 18, 94 22 S122 48, 140 38 S168 12, 186 18 S214 34, 238 28" }
  ];

  var cloudProfile = null;
  var cloudSession = null;
  var cloudPosts = [];

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function write(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

  function getUsers() { return read(STORAGE.users, []); }
  function getPostsLocal() { return read(STORAGE.posts, []); }
  function getVotes() { return read(STORAGE.votes, {}); }
  function getNewsletter() { return read(STORAGE.newsletter, []); }
  function getSessionLocal() { return read(STORAGE.session, null); }
  function getAdminSession() { return read(STORAGE.adminSession, null); }

  function setSessionLocal(email) {
    if (!email) localStorage.removeItem(STORAGE.session);
    else write(STORAGE.session, { email: email });
  }
  function setAdminSession(on) {
    if (!on) localStorage.removeItem(STORAGE.adminSession);
    else write(STORAGE.adminSession, { at: Date.now(), email: CONFIG.ADMIN_EMAIL || "admin@stoneforge.com" });
  }

  function findUser(email) {
    var e = (email || "").trim().toLowerCase();
    return getUsers().find(function (u) { return u.email === e; }) || null;
  }

  function nextPosition() {
    var n = Number(localStorage.getItem(STORAGE.counter) || 2847) + 1;
    localStorage.setItem(STORAGE.counter, String(n));
    return n;
  }

  function makeCode() {
    var alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
    var out = "";
    for (var i = 0; i < 7; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
    return out;
  }

  function referralUrl(code) {
    var url = new URL("index.html", window.location.href);
    url.searchParams.set("ref", code);
    return url.toString();
  }

  function getRefFromQuery() {
    try { return new URLSearchParams(window.location.search).get("ref") || ""; }
    catch (e) { return ""; }
  }

  function bumpReferrer(code) {
    if (!code) return;
    var users = getUsers().map(function (u) {
      if (u.code !== code) return u;
      return Object.assign({}, u, {
        position: Math.max(1, (u.position || 2) - 1),
        referrals: (u.referrals || 0) + 1
      });
    });
    write(STORAGE.users, users);
  }

  function hash(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; }
    return "sf" + String(h);
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function isAdmin() {
    if (useCloud()) return !!(cloudProfile && cloudProfile.is_admin);
    return !!getAdminSession();
  }

  function ensureWaitlistUser(email, name) {
    var existing = findUser(email);
    if (existing) return existing;
    var user = {
      email: email.trim().toLowerCase(),
      name: name || email.split("@")[0],
      passwordHash: null,
      position: nextPosition(),
      code: makeCode(),
      referrals: 0,
      createdAt: Date.now()
    };
    var users = getUsers();
    users.push(user);
    write(STORAGE.users, users);
    bumpReferrer(getRefFromQuery());
    return user;
  }

  function copyText(value, btn) {
    if (!value) return;
    var done = function () {
      if (!btn) return;
      var prev = btn.textContent;
      btn.textContent = "Copied";
      setTimeout(function () { btn.textContent = prev; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(done).catch(function () {});
    } else done();
  }

  function openClaimSheet(email, position, code) {
    var sheet = document.getElementById("claim-sheet");
    if (!sheet) return false;
    var posEl = document.getElementById("claim-position");
    var emailEl = document.getElementById("claim-email");
    var nameEl = document.getElementById("claim-name");
    var refEl = document.getElementById("claim-referral");
    var status = document.getElementById("claim-status");
    if (posEl) posEl.textContent = String(position);
    if (emailEl) emailEl.value = email;
    if (nameEl && !nameEl.value) nameEl.value = String(email).split("@")[0] || "";
    if (refEl) refEl.value = referralUrl(code);
    if (status) status.textContent = "";
    try {
      sessionStorage.setItem("sf_pending_claim", JSON.stringify({ email: email, position: position, code: code }));
    } catch (e) {}
    sheet.hidden = false;
    document.body.classList.add("claim-open");
    setTimeout(function () {
      if (nameEl) nameEl.focus();
    }, 80);
    return true;
  }

  function closeClaimSheet() {
    var sheet = document.getElementById("claim-sheet");
    if (sheet) sheet.hidden = true;
    document.body.classList.remove("claim-open");
    try { sessionStorage.removeItem("sf_pending_claim"); } catch (e) {}
  }

  function showWaitlistSuccess(form, position, code, email) {
    email = String(email || "").trim().toLowerCase();
    if (!email) {
      var emailInput = form.querySelector('input[name="email"]');
      email = emailInput ? String(emailInput.value || "").trim().toLowerCase() : "";
    }
    // Prefer home claim sheet (finish login right after join)
    if (email && openClaimSheet(email, position, code)) {
      var msg = form.querySelector("[data-waitlist-msg]");
      if (msg) {
        msg.innerHTML = "You’re <strong>#" + position + "</strong> — finish your login below.";
        msg.classList.add("is-visible");
      }
      return;
    }
    var msg = form.querySelector("[data-waitlist-msg]");
    var share = form.querySelector("[data-waitlist-share]");
    var link = form.querySelector("[data-referral-link]");
    if (msg) {
      msg.innerHTML = "You’re <strong>#" + position + "</strong> on the StoneForge list. <a href=\"spot.html\" style=\"color:var(--accent-deep);font-weight:600\">Create your login →</a>";
      msg.classList.add("is-visible");
    }
    if (share && link) {
      link.value = referralUrl(code);
      share.classList.add("is-visible");
      share.hidden = false;
    }
  }

  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduceMotion && "IntersectionObserver" in window) {
    var fadeObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in");
          fadeObs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    document.querySelectorAll(".fade-up").forEach(function (el) { fadeObs.observe(el); });
  } else {
    document.querySelectorAll(".fade-up").forEach(function (el) { el.classList.add("is-in"); });
  }

  (function () {
    var video = document.querySelector(".site__video");
    if (!video) return;
    video.controls = false;
    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0;
    video.loop = true;
    video.autoplay = true;
    video.playsInline = true;
    function tryPlay() {
      var p = video.play();
      if (p && p.then) p.then(function () { video.classList.add("is-ready"); }).catch(function () {});
    }
    tryPlay();
    video.addEventListener("playing", function () { video.classList.add("is-ready"); });
  })();

  (function () {
    var ticker = document.getElementById("orion-ticker");
    var reason = document.getElementById("orion-reason");
    var path = document.getElementById("orion-path");
    var spark = document.getElementById("orion-spark");
    var clock = document.getElementById("orion-clock");
    if (!ticker || !reason || !path || !spark) return;
    var i = 0;
    if (reduceMotion) return;
    setInterval(function () {
      i = (i + 1) % ORION_LINES.length;
      var line = ORION_LINES[i];
      ticker.textContent = line.ticker;
      reason.textContent = line.reason;
      path.setAttribute("d", line.path);
      spark.classList.remove("is-drawn");
      void spark.offsetWidth;
      spark.classList.add("is-drawn");
      if (clock) clock.textContent = "just now";
    }, 4200);
  })();

  /* Waitlist — home only */
  document.querySelectorAll("form[data-waitlist]").forEach(function (form) {
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var emailInput = form.querySelector('input[name="email"]');
      var email = emailInput && String(emailInput.value || "").trim().toLowerCase();
      var statusMsg = form.querySelector("[data-waitlist-msg]");
      if (!email) return;
      try {
        var position;
        var code;
        var isNewLocal = false;
        if (useCloud()) {
          try {
            var row = await Cloud.joinWaitlist(email, null, getRefFromQuery() || null);
            position = row.position;
            code = row.referral_code;
          } catch (cloudErr) {
            // Keep the join UX alive if Supabase table isn't ready yet
            console.warn("Cloud waitlist failed, using local:", cloudErr);
            isNewLocal = !findUser(email);
            var localUser = ensureWaitlistUser(email);
            setSessionLocal(localUser.email);
            position = localUser.position;
            code = localUser.code;
          }
        } else {
          isNewLocal = !findUser(email);
          var user = ensureWaitlistUser(email);
          setSessionLocal(user.email);
          position = user.position;
          code = user.code;
        }

        if (isNewLocal && Cloud && Cloud.notifyWaitlist) {
          Cloud.notifyWaitlist({
            type: "waitlist",
            email: email,
            name: email.split("@")[0],
            position: position,
            referralCode: code,
            referredBy: getRefFromQuery() || "",
            source: "website-local",
            createdAt: new Date().toISOString()
          });
        }

        showWaitlistSuccess(form, position, code, email);
        refreshSessionUI();
        emailInput.value = "";
      } catch (err) {
        if (statusMsg) {
          statusMsg.textContent = err.message || "Could not join waitlist";
          statusMsg.classList.add("is-visible");
        } else {
          alert(err.message || "Could not join waitlist");
        }
      }
    });

    var copyBtn = form.querySelector("[data-copy-referral]");
    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        var link = form.querySelector("[data-referral-link]");
        copyText(link && link.value, copyBtn);
      });
    }
  });

  function refreshSessionUI() {
    var bar = document.getElementById("session-bar");
    var nameEl = document.getElementById("session-name");
    var card = document.getElementById("position-card");
    var empty = document.getElementById("position-empty");
    var num = document.getElementById("position-num");
    var ref = document.getElementById("position-referral");
    var composeAvatar = document.querySelector(".compose .avatar");

    function setSignedIn(name, positionText, referral) {
      if (bar) bar.classList.add("is-visible");
      if (nameEl) nameEl.textContent = name;
      if (card) card.classList.add("is-visible");
      if (empty) empty.style.display = "none";
      if (num) num.textContent = positionText;
      if (ref && referral) ref.value = referral;
      if (composeAvatar) composeAvatar.textContent = initials(name);
    }

    function setSignedOut() {
      if (bar) bar.classList.remove("is-visible");
      if (card) card.classList.remove("is-visible");
      if (empty) empty.style.display = "block";
      if (composeAvatar) composeAvatar.textContent = "+";
    }

    if (useCloud()) {
      if (cloudProfile) {
        setSignedIn(
          cloudProfile.name,
          cloudProfile.waitlist_position ? ("#" + cloudProfile.waitlist_position) : "—",
          cloudProfile.referral_code ? referralUrl(cloudProfile.referral_code) : ""
        );
      } else {
        setSignedOut();
      }
      return;
    }

    var session = getSessionLocal();
    var user = session ? findUser(session.email) : null;
    if (user) {
      setSignedIn(user.name, "#" + user.position, referralUrl(user.code));
    } else {
      setSignedOut();
    }
  }

  window.__sfRefreshSession = refreshSessionUI;

  var signOut = document.getElementById("sign-out-btn");
  if (signOut) {
    signOut.addEventListener("click", async function () {
      if (useCloud()) await Cloud.signOut();
      cloudSession = null;
      cloudProfile = null;
      setSessionLocal(null);
      refreshSessionUI();
      renderPosts();
    });
  }

  var positionCopy = document.getElementById("position-copy");
  if (positionCopy) {
    positionCopy.addEventListener("click", function () {
      copyText(document.getElementById("position-referral") && document.getElementById("position-referral").value, positionCopy);
    });
  }

  var signupForm = document.getElementById("signup-form");
  var signinForm = document.getElementById("signin-form");

  document.querySelectorAll("[data-auth]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll("[data-auth]").forEach(function (b) {
        b.classList.toggle("is-active", b === btn);
      });
      if (!signupForm || !signinForm) return;
      var mode = btn.getAttribute("data-auth");
      signupForm.hidden = mode !== "signup";
      signinForm.hidden = mode !== "signin";
    });
  });

  async function completeAccount(email, password, name, statusEl) {
    if (useCloud()) {
      await Cloud.signUp(email, password, name);
      await Cloud.signIn(email, password);
      await bootCloud();
      if (statusEl) statusEl.textContent = "Login ready. You’re signed in.";
      return;
    }
    var existing = findUser(email);
    var users = getUsers();
    if (existing && existing.passwordHash) {
      throw new Error("An account with that email already exists. Sign in on Your Spot.");
    }
    if (existing && !existing.passwordHash) {
      existing.name = name || existing.name;
      existing.passwordHash = hash(password);
      write(STORAGE.users, users.map(function (u) { return u.email === email ? existing : u; }));
      setSessionLocal(email);
      if (statusEl) statusEl.textContent = "Login ready. You’re #" + existing.position + ".";
      refreshSessionUI();
      return;
    }
    var user = {
      email: email, name: name, passwordHash: hash(password),
      position: nextPosition(), code: makeCode(), referrals: 0, createdAt: Date.now()
    };
    users.push(user);
    write(STORAGE.users, users);
    bumpReferrer(getRefFromQuery());
    setSessionLocal(email);
    if (statusEl) statusEl.textContent = "You’re in. Position #" + user.position + ".";
    refreshSessionUI();
  }

  if (signupForm) {
    signupForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      var fd = new FormData(signupForm);
      var name = String(fd.get("name") || "").trim();
      var email = String(fd.get("email") || "").trim().toLowerCase();
      var password = String(fd.get("password") || "");
      var status = document.getElementById("signup-status");
      try {
        await completeAccount(email, password, name, status);
        signupForm.reset();
      } catch (err) {
        status.textContent = err.message || "Signup failed";
      }
    });
  }

  var claimForm = document.getElementById("claim-form");
  if (claimForm) {
    claimForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      var fd = new FormData(claimForm);
      var name = String(fd.get("name") || "").trim();
      var email = String(fd.get("email") || "").trim().toLowerCase();
      var password = String(fd.get("password") || "");
      var status = document.getElementById("claim-status");
      try {
        await completeAccount(email, password, name, status);
        setTimeout(function () {
          closeClaimSheet();
          window.location.href = "spot.html";
        }, 700);
      } catch (err) {
        if (status) status.textContent = err.message || "Couldn’t create login";
      }
    });
  }

  var claimSkip = document.getElementById("claim-skip");
  if (claimSkip) {
    claimSkip.addEventListener("click", function () {
      closeClaimSheet();
    });
  }

  var claimCopy = document.getElementById("claim-copy");
  if (claimCopy) {
    claimCopy.addEventListener("click", function () {
      copyText(document.getElementById("claim-referral") && document.getElementById("claim-referral").value, claimCopy);
    });
  }

  // Restore claim sheet if user refreshed mid-flow
  (function () {
    if (!document.getElementById("claim-sheet")) return;
    try {
      var raw = sessionStorage.getItem("sf_pending_claim");
      if (!raw) return;
      var pending = JSON.parse(raw);
      if (pending && pending.email) openClaimSheet(pending.email, pending.position, pending.code);
    } catch (e) {}
  })();

  if (signinForm) {
    signinForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      var fd = new FormData(signinForm);
      var email = String(fd.get("email") || "").trim().toLowerCase();
      var password = String(fd.get("password") || "");
      var status = document.getElementById("signin-status");
      try {
        if (useCloud()) {
          await Cloud.signIn(email, password);
          await bootCloud();
          status.textContent = "Signed in.";
          signinForm.reset();
          return;
        }
        var user = findUser(email);
        if (!user || !user.passwordHash || user.passwordHash !== hash(password)) {
          status.textContent = "Couldn’t sign in — check email and password.";
          return;
        }
        setSessionLocal(email);
        status.textContent = "Signed in. You’re #" + user.position + ".";
        refreshSessionUI();
        signinForm.reset();
      } catch (err) {
        status.textContent = err.message || "Sign in failed";
      }
    });
  }

  /* Forum rendering */
  function scoreCloud(post) {
    var up = 0, down = 0, mine = 0;
    (post.votes || []).forEach(function (v) {
      if (v.value === 1) up += 1;
      if (v.value === -1) down += 1;
      if (cloudSession && v.user_id === cloudSession.user.id) mine = v.value;
    });
    return { up: up, down: down, score: up - down, mine: mine };
  }

  function scoreLocal(postId) {
    var votes = getVotes()[postId] || {};
    var up = 0, down = 0;
    var key = isAdmin() ? ("admin:" + (CONFIG.ADMIN_EMAIL || "admin")) : (getSessionLocal() && ("user:" + getSessionLocal().email));
    Object.keys(votes).forEach(function (k) {
      if (votes[k] === 1) up += 1;
      if (votes[k] === -1) down += 1;
    });
    return { up: up, down: down, score: up - down, mine: (key && votes[key]) || 0 };
  }

  function initials(name) {
    var parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  var ICON_UP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  var ICON_DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>';

  function renderReplies(replies) {
    if (!replies || !replies.length) return "";
    return '<div class="thread">' + replies.map(function (r) {
      var admin = r.is_admin || r.isAdmin;
      var author = r.author_name || r.author || "Member";
      var when = new Date(r.created_at || r.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      return (
        '<div class="thread-reply' + (admin ? " thread-reply--admin" : "") + '">' +
          '<div class="thread-reply__top">' +
            '<div class="avatar avatar--sm' + (admin ? " avatar--admin" : "") + '" aria-hidden="true">' + escapeHtml(initials(author)) + "</div>" +
            '<span class="tweet__name">' + escapeHtml(author) + "</span>" +
            (admin ? '<span class="admin-pill">Admin</span>' : "") +
            '<span class="tweet__meta">· ' + when + "</span>" +
          "</div>" +
          '<p class="tweet__text" style="margin-top:4px">' + escapeHtml(r.body) + "</p>" +
        "</div>"
      );
    }).join("") + "</div>";
  }

  function adminReplyForm(postId) {
    if (!isAdmin()) return "";
    return (
      '<form class="admin-reply-form admin-compose" data-reply-to="' + postId + '">' +
        '<textarea name="body" required maxlength="800" placeholder="Reply as StoneForge admin…"></textarea>' +
        '<div class="btn-row" style="margin-top:10px"><button class="btn" type="submit">Post reply</button></div>' +
      "</form>"
    );
  }

  function canVote() {
    if (useCloud()) return !!cloudSession;
    return !!(getSessionLocal() || getAdminSession());
  }

  function renderPosts() {
    var root = document.getElementById("posts");
    if (!root) return;

    var posts;
    if (useCloud()) {
      posts = cloudPosts.slice().sort(function (a, b) {
        var d = scoreCloud(b).score - scoreCloud(a).score;
        return d !== 0 ? d : new Date(b.created_at) - new Date(a.created_at);
      });
    } else {
      posts = getPostsLocal().slice().sort(function (a, b) {
        var d = scoreLocal(b.id).score - scoreLocal(a.id).score;
        return d !== 0 ? d : b.createdAt - a.createdAt;
      });
    }

    if (!posts.length) {
      root.innerHTML = '<p class="feed-empty">No posts yet. Be the first tip on the trail.</p>';
      return;
    }

    var voting = canVote();
    root.innerHTML = posts.map(function (p) {
      var id = p.id;
      var typeLabel = p.type === "question" ? "Question" : "Tip";
      var author = p.author_name || p.author || "Member";
      var when = new Date(p.created_at || p.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      var sc = useCloud() ? scoreCloud(p) : scoreLocal(id);
      var replies = p.replies || [];
      return (
        '<article class="tweet" data-post-id="' + id + '">' +
          '<div class="tweet__row">' +
            '<div class="avatar" aria-hidden="true">' + escapeHtml(initials(author)) + "</div>" +
            '<div class="tweet__body">' +
              '<div class="tweet__head">' +
                '<span class="tweet__name">' + escapeHtml(author) + "</span>" +
                '<span class="tweet__meta">· ' + when + "</span>" +
                '<span class="tweet__chip">' + typeLabel + "</span>" +
              "</div>" +
              '<h3 class="tweet__title">' + escapeHtml(p.title) + "</h3>" +
              '<p class="tweet__text">' + escapeHtml(p.body) + "</p>" +
              '<div class="tweet__actions">' +
                '<button type="button" class="action is-up' + (sc.mine === 1 ? " is-active" : "") + '" data-vote="1" data-id="' + id + '"' + (voting ? "" : " disabled") + ' aria-label="Upvote">' + ICON_UP + "<span>" + sc.up + "</span></button>" +
                '<button type="button" class="action is-down' + (sc.mine === -1 ? " is-active" : "") + '" data-vote="-1" data-id="' + id + '"' + (voting ? "" : " disabled") + ' aria-label="Downvote">' + ICON_DOWN + "<span>" + sc.down + "</span></button>" +
                '<span class="tweet__score">Score ' + sc.score + "</span>" +
              "</div>" +
              renderReplies(replies) +
              adminReplyForm(id) +
            "</div>" +
          "</div>" +
        "</article>"
      );
    }).join("");
  }

  async function reloadPosts() {
    if (useCloud()) {
      cloudPosts = await Cloud.fetchPosts();
    }
    renderPosts();
  }

  var postsRoot = document.getElementById("posts");
  if (postsRoot) {
    postsRoot.addEventListener("click", async function (e) {
      var btn = e.target.closest("[data-vote]");
      if (!btn) return;
      var id = btn.getAttribute("data-id");
      var value = Number(btn.getAttribute("data-vote"));
      try {
        if (useCloud()) {
          if (!cloudSession) throw new Error("Sign in on Your Spot to vote.");
          await Cloud.vote(id, value);
          await reloadPosts();
          return;
        }
        var key = isAdmin() ? ("admin:" + (CONFIG.ADMIN_EMAIL || "admin")) : (getSessionLocal() && ("user:" + getSessionLocal().email));
        if (!key) {
          var status = document.getElementById("post-status");
          if (status) status.textContent = "Sign in on Your Spot to vote.";
          return;
        }
        var all = getVotes();
        var votes = all[id] || {};
        if (votes[key] === value) delete votes[key];
        else votes[key] = value;
        all[id] = votes;
        write(STORAGE.votes, all);
        renderPosts();
      } catch (err) {
        alert(err.message || "Vote failed");
      }
    });

    postsRoot.addEventListener("submit", async function (e) {
      var form = e.target.closest(".admin-reply-form");
      if (!form) return;
      e.preventDefault();
      var id = form.getAttribute("data-reply-to");
      var body = String(new FormData(form).get("body") || "").trim();
      if (!body) return;
      try {
        if (useCloud()) {
          await Cloud.adminReply(id, body);
          await reloadPosts();
          return;
        }
        if (!isAdmin()) return;
        var posts = getPostsLocal().map(function (p) {
          if (p.id !== id) return p;
          var replies = (p.replies || []).slice();
          replies.push({ id: String(Date.now()), author: "StoneForge", body: body, isAdmin: true, createdAt: Date.now() });
          return Object.assign({}, p, { replies: replies });
        });
        write(STORAGE.posts, posts);
        renderPosts();
      } catch (err) {
        alert(err.message || "Reply failed");
      }
    });
  }

  var postForm = document.getElementById("post-form");
  if (postForm) {
    postForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      var status = document.getElementById("post-status");
      var fd = new FormData(e.target);
      var type = String(fd.get("type"));
      var title = String(fd.get("title") || "").trim();
      var body = String(fd.get("body") || "").trim();
      try {
        if (useCloud()) {
          if (!cloudSession) throw new Error("Sign in on Your Spot to post.");
          await Cloud.createPost(type, title, body);
          e.target.reset();
          status.textContent = "Posted. We emailed the team.";
          await reloadPosts();
          return;
        }
        var session = getSessionLocal();
        var user = session ? findUser(session.email) : null;
        if (!user && !isAdmin()) {
          status.textContent = "Sign in on Your Spot to post.";
          return;
        }
        var posts = getPostsLocal();
        posts.push({
          id: String(Date.now()),
          type: type, title: title, body: body,
          author: user ? user.name : "StoneForge",
          email: user ? user.email : (CONFIG.ADMIN_EMAIL || "admin"),
          replies: [],
          createdAt: Date.now()
        });
        write(STORAGE.posts, posts);
        if (Cloud && Cloud.notifyForum) {
          Cloud.notifyForum({
            type: type, title: title, body: body,
            author: user ? user.name : "StoneForge",
            email: user ? user.email : "",
            createdAt: new Date().toISOString()
          });
        }
        e.target.reset();
        status.textContent = "Posted.";
        renderPosts();
      } catch (err) {
        status.textContent = err.message || "Post failed";
      }
    });
  }

  var newsletterForm = document.getElementById("newsletter-form");
  if (newsletterForm) {
    newsletterForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = String(new FormData(e.target).get("email") || "").trim().toLowerCase();
      var list = getNewsletter();
      if (list.indexOf(email) === -1) {
        list.push(email);
        write(STORAGE.newsletter, list);
      }
      document.getElementById("newsletter-status").textContent = "You’re on the weekly StoneForge dispatch.";
      e.target.reset();
    });
  }

  /* Admin page — cloud uses real is_admin profile; local uses config password */
  var adminForm = document.getElementById("admin-login-form");
  if (adminForm) {
    var adminStatus = document.getElementById("admin-status");
    var adminGate = document.getElementById("admin-gate");
    var adminApp = document.getElementById("admin-app");

    function refreshAdminUI() {
      var on = isAdmin();
      if (adminGate) adminGate.hidden = on;
      if (adminApp) adminApp.hidden = !on;
      if (on) renderPosts();
    }

    adminForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      var fd = new FormData(adminForm);
      var email = String(fd.get("email") || "").trim().toLowerCase();
      var password = String(fd.get("password") || "");
      try {
        if (useCloud()) {
          await Cloud.signIn(email, password);
          await bootCloud();
          if (!cloudProfile || !cloudProfile.is_admin) {
            await Cloud.signOut();
            cloudSession = null;
            cloudProfile = null;
            throw new Error("This account is not marked is_admin in Supabase yet.");
          }
          adminStatus.textContent = "Signed in as admin.";
          refreshAdminUI();
          return;
        }
        if (email === (CONFIG.ADMIN_EMAIL || "").toLowerCase() && password === (CONFIG.ADMIN_PASSWORD || "")) {
          setAdminSession(true);
          adminStatus.textContent = "Signed in as admin.";
          refreshAdminUI();
        } else {
          adminStatus.textContent = "Wrong admin email or password.";
        }
      } catch (err) {
        adminStatus.textContent = err.message || "Admin login failed";
      }
    });

    var adminOut = document.getElementById("admin-sign-out");
    if (adminOut) {
      adminOut.addEventListener("click", async function () {
        if (useCloud()) await Cloud.signOut();
        setAdminSession(false);
        cloudSession = null;
        cloudProfile = null;
        refreshAdminUI();
      });
    }

    window.__sfRefreshAdmin = refreshAdminUI;
  }

  var forumAdminBanner = document.getElementById("forum-admin-banner");

  var modeNote = document.getElementById("backend-mode");
  if (modeNote) {
    modeNote.textContent = useCloud()
      ? "Connected to Supabase. Forum posts & logins are live."
      : "Local mode — add Supabase keys in config.js.";
  }

  async function bootCloud() {
    if (!useCloud()) return;
    cloudSession = await Cloud.getSession();
    cloudProfile = cloudSession ? await Cloud.getProfile() : null;
    refreshSessionUI();
    if (forumAdminBanner) forumAdminBanner.hidden = !isAdmin();
    if (typeof window.__sfRefreshAdmin === "function") window.__sfRefreshAdmin();
    await reloadPosts();
  }

  // Seed local posts if needed
  if (!useCloud() && !getPostsLocal().length) {
    write(STORAGE.posts, [{
      id: "seed1", type: "tip",
      title: "Paper mode first — then flip live",
      body: "Ran Orion on paper for two weeks. The reasoning lines made the misses obvious before I risked a dollar.",
      author: "trailhand", email: "seed@stoneforge.local",
      replies: [{ id: "r1", author: "StoneForge", body: "This is exactly the path we recommend.", isAdmin: true, createdAt: Date.now() - 86400000 }],
      createdAt: Date.now() - 86400000 * 2
    }]);
  }

  if (useCloud()) {
    bootCloud().catch(function (err) { console.error(err); renderPosts(); refreshSessionUI(); });
  } else {
    renderPosts();
    refreshSessionUI();
    if (forumAdminBanner) forumAdminBanner.hidden = !isAdmin();
  }
})();
