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

  var ALIAS_ADJ = ["Arctic", "Amber", "Bold", "Bright", "Calm", "Copper", "Crimson", "Dusky", "Ember", "Golden", "Hidden", "Iron", "Jade", "Keen", "Lunar", "Misty", "Noble", "Quiet", "Rapid", "Silver", "Solar", "Swift", "Wild", "Young"];
  var ALIAS_ANIMALS = ["Fox", "Otter", "Hawk", "Wolf", "Bear", "Lynx", "Heron", "Puma", "Owl", "Elk", "Raven", "Seal", "Stag", "Wren", "Hare", "Finch"];

  function randomAlias() {
    return ALIAS_ADJ[Math.floor(Math.random() * ALIAS_ADJ.length)] + " " + ALIAS_ANIMALS[Math.floor(Math.random() * ALIAS_ANIMALS.length)];
  }

  function hash(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; }
    return "sf" + String(h);
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function isFounderSession() {
    var email = cloudSession && cloudSession.user && cloudSession.user.email;
    if (Cloud && Cloud.isFounderEmail) return Cloud.isFounderEmail(email);
    return String(email || "").toLowerCase() === String(CONFIG.ADMIN_EMAIL || "").toLowerCase();
  }

  function isAdmin() {
    if (useCloud()) return !!((cloudProfile && cloudProfile.is_admin) || isFounderSession());
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
    if (nameEl && !nameEl.value) nameEl.value = randomAlias();
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
    function markPlaying() {
      if (video.paused) return;
      video.classList.add("is-ready");
      if (video.parentElement) video.parentElement.classList.add("is-playing");
    }
    function tryPlay() {
      var p = video.play();
      if (p && p.then) p.then(markPlaying).catch(function () {});
    }
    tryPlay();
    video.addEventListener("playing", markPlaying);
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
    var nameCard = document.getElementById("name-card");

    function setSignedIn(name, positionText, referral) {
      if (bar) bar.classList.add("is-visible");
      if (nameEl) nameEl.textContent = name;
      if (card) card.classList.add("is-visible");
      if (empty) empty.style.display = "none";
      if (num) num.textContent = positionText;
      if (ref && referral) ref.value = referral;
      if (composeAvatar) composeAvatar.textContent = initials(name);
      if (nameCard) nameCard.hidden = false;
      syncNameEditor(name);
    }

    function setSignedOut() {
      if (bar) bar.classList.remove("is-visible");
      if (card) card.classList.remove("is-visible");
      if (empty) empty.style.display = "block";
      if (composeAvatar) composeAvatar.textContent = "+";
      if (nameCard) nameCard.hidden = true;
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

  var nameMode = "anon";

  function currentIdentity() {
    var meta = (cloudSession && cloudSession.user && cloudSession.user.user_metadata) || {};
    var local = getSessionLocal() ? findUser(getSessionLocal().email) : null;
    var alias = meta.alias || (local && local.alias) || "";
    var publicName = meta.public_name || (local && local.publicName) || "";
    var anonymous = meta.anonymous !== false && !(local && local.anonymous === false);
    if (useCloud() && cloudProfile && meta.anonymous === undefined && !local) {
      alias = alias || cloudProfile.name || randomAlias();
    }
    if (!alias) alias = (local && local.name) || (cloudProfile && cloudProfile.name) || randomAlias();
    var shown = anonymous ? alias : (publicName || alias);
    return { alias: alias, publicName: publicName, anonymous: anonymous, shown: shown };
  }

  function syncNameEditor(shownName) {
    var input = document.getElementById("public-name");
    var shuffle = document.getElementById("shuffle-name");
    var id = currentIdentity();
    nameMode = id.anonymous ? "anon" : "public";
    document.querySelectorAll("[data-name-mode]").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.getAttribute("data-name-mode") === nameMode);
    });
    if (shuffle) shuffle.hidden = nameMode !== "anon";
    if (input && document.activeElement !== input) {
      input.value = nameMode === "anon" ? id.alias : (id.publicName || shownName || "");
    }
  }

  document.querySelectorAll("[data-name-mode]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      nameMode = btn.getAttribute("data-name-mode");
      document.querySelectorAll("[data-name-mode]").forEach(function (b) {
        b.classList.toggle("is-active", b === btn);
      });
      var input = document.getElementById("public-name");
      var shuffle = document.getElementById("shuffle-name");
      var id = currentIdentity();
      if (shuffle) shuffle.hidden = nameMode !== "anon";
      if (!input) return;
      if (nameMode === "anon") input.value = id.alias || randomAlias();
      else input.value = id.publicName || "";
    });
  });

  var shuffleBtn = document.getElementById("shuffle-name");
  if (shuffleBtn) {
    shuffleBtn.addEventListener("click", function () {
      var input = document.getElementById("public-name");
      if (input) input.value = randomAlias();
    });
  }

  var nameForm = document.getElementById("name-form");
  if (nameForm) {
    nameForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      var input = document.getElementById("public-name");
      var status = document.getElementById("name-status");
      var value = String((input && input.value) || "").trim();
      if (!value) {
        if (status) status.textContent = "Pick a name first.";
        return;
      }
      var id = currentIdentity();
      var anonymous = nameMode !== "public";
      var alias = anonymous ? value : id.alias;
      var publicName = anonymous ? id.publicName : value;
      var shown = anonymous ? alias : publicName;
      try {
        if (useCloud()) {
          if (!Cloud.setPublicIdentity) throw new Error("Can’t save the name right now.");
          cloudProfile = await Cloud.setPublicIdentity(shown, {
            anonymous: anonymous,
            alias: alias,
            public_name: publicName
          });
          cloudSession = await Cloud.getSession();
        } else {
          var session = getSessionLocal();
          var user = session ? findUser(session.email) : null;
          if (!user) throw new Error("Sign in first.");
          user.name = shown;
          user.alias = alias;
          user.publicName = publicName;
          user.anonymous = anonymous;
          write(STORAGE.users, getUsers().map(function (u) { return u.email === user.email ? user : u; }));
        }
        if (status) status.textContent = anonymous ? "Anonymous name saved." : "Public name saved.";
        refreshSessionUI();
      } catch (err) {
        if (status) status.textContent = err.message || "Couldn’t save name";
      }
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
    name = String(name || "").trim() || randomAlias();
    if (useCloud()) {
      var created = await Cloud.signUp(email, password, name);
      if (!created.session) {
        try {
          await Cloud.signIn(email, password);
        } catch (err) {
          var msg = (err && err.message) || "";
          if (/confirm/i.test(msg)) {
            if (statusEl) statusEl.textContent = "Check your inbox and tap Confirm email. Then sign in on Your Spot.";
            return;
          }
          throw err;
        }
      }
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
      existing.name = name || existing.name || randomAlias();
      existing.alias = existing.alias || existing.name;
      existing.anonymous = existing.anonymous !== false;
      existing.passwordHash = hash(password);
      write(STORAGE.users, users.map(function (u) { return u.email === email ? existing : u; }));
      setSessionLocal(email);
      if (statusEl) statusEl.textContent = "Login ready. You’re #" + existing.position + ".";
      refreshSessionUI();
      return;
    }
    var user = {
      email: email, name: name, alias: name, anonymous: true, publicName: "",
      passwordHash: hash(password),
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

  var claimShuffle = document.getElementById("claim-shuffle");
  if (claimShuffle) {
    claimShuffle.addEventListener("click", function () {
      var nameEl = document.getElementById("claim-name");
      if (nameEl) nameEl.value = randomAlias();
    });
  }

  var signupName = document.getElementById("signup-name");
  if (signupName && !signupName.value) signupName.value = randomAlias();

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
          var founder = String(email).toLowerCase() === String(CONFIG.ADMIN_EMAIL || "").toLowerCase();
          var passOk = password === (CONFIG.ADMIN_PASSWORD || "");
          try {
            await Cloud.signIn(email, password);
          } catch (signInErr) {
            if (!(founder && passOk)) throw signInErr;
            await Cloud.signUp(email, password, "StoneForge");
            await Cloud.signIn(email, password);
          }
          await bootCloud();
          if (Cloud.ensureFounderAdmin) cloudProfile = await Cloud.ensureFounderAdmin() || cloudProfile;
          if (!isAdmin()) {
            await Cloud.signOut();
            cloudSession = null;
            cloudProfile = null;
            throw new Error("This account cannot reply as admin.");
          }
          adminStatus.textContent = "Signed in. Your replies will be highlighted.";
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
        var msg = err.message || "Admin login failed";
        if (/not confirmed/i.test(msg)) {
          msg = "Confirm founder@stoneforge.app from the Supabase email, then sign in again.";
        }
        adminStatus.textContent = msg;
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
    if (cloudProfile && Cloud.ensureFounderAdmin && isFounderSession()) {
      cloudProfile = await Cloud.ensureFounderAdmin() || cloudProfile;
    }
    refreshSessionUI();
    if (forumAdminBanner) forumAdminBanner.hidden = !isAdmin();
    if (typeof window.__sfRefreshAdmin === "function") window.__sfRefreshAdmin();
    try {
      await reloadPosts();
    } catch (err) {
      var postStatus = document.getElementById("post-status");
      if (postStatus) postStatus.textContent = err.message || "Couldn’t load the forum.";
    }
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
