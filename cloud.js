/* Supabase + email notify helpers */
(function (global) {
  "use strict";

  var CONFIG = global.SF_CONFIG || {};
  var client = null;

  function enabled() {
    return !!(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY && global.supabase);
  }

  function db() {
    if (!enabled()) return null;
    if (!client) {
      client = global.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
    }
    return client;
  }

  async function notifyGas(payload) {
    var url = CONFIG.GAS_WEBHOOK_URL;
    if (!url) return;
    try {
      // text/plain + no-cors avoids Apps Script CORS preflight issues
      await fetch(url, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      console.warn("GAS notify failed", e);
    }
  }

  async function notifyForum(payload) {
    return notifyGas(payload);
  }

  async function notifyWaitlist(payload) {
    return notifyGas(Object.assign({ type: "waitlist" }, payload || {}));
  }

  async function getSession() {
    var sb = db();
    if (!sb) return null;
    var res = await sb.auth.getSession();
    return res.data.session || null;
  }

  function raise(error) {
    if (!error) return;
    var msg = error.message || "Request failed";
    if (error.code === "42501" || /permission denied for table/i.test(msg)) {
      throw new Error("Your account is saved. Forum access still needs a one-time grant in Supabase.");
    }
    if (/email not confirmed/i.test(msg)) {
      throw new Error("Check your inbox and tap Confirm email. Then sign in.");
    }
    if (/rate limit/i.test(msg)) {
      throw new Error("Too many confirmation emails just went out. Wait a minute and try again.");
    }
    if (/already registered/i.test(msg)) {
      throw new Error("That email already has an account. Sign in on Your Spot.");
    }
    var wrapped = new Error(msg);
    wrapped.code = error.code;
    throw wrapped;
  }

  async function getProfile() {
    var sb = db();
    var session = await getSession();
    if (!sb || !session) return null;
    var res = await sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
    if (res.error) return null;
    return res.data || null;
  }

  async function ensureProfile() {
    var existing = await getProfile();
    if (existing) return existing;
    var sb = db();
    var session = await getSession();
    if (!sb || !session) throw new Error("Sign in required");
    var meta = session.user.user_metadata || {};
    var name = meta.name || String(session.user.email || "member").split("@")[0];
    var res = await sb.from("profiles").insert({
      id: session.user.id,
      email: session.user.email,
      name: name
    }).select("*").single();
    if (res.error && res.error.code !== "23505") raise(res.error);
    return (await getProfile()) || res.data;
  }

  function isFounderEmail(email) {
    return String(email || "").trim().toLowerCase() === String(CONFIG.ADMIN_EMAIL || "").trim().toLowerCase();
  }

  async function updateProfile(patch) {
    var sb = db();
    var session = await getSession();
    if (!sb || !session) throw new Error("Sign in required");
    var res = await sb.from("profiles").update(patch).eq("id", session.user.id).select("*").single();
    if (res.error) throw res.error;
    return res.data;
  }

  async function setPublicIdentity(displayName, meta) {
    var sb = db();
    var session = await getSession();
    if (!sb || !session) throw new Error("Sign in required");
    var authRes = await sb.auth.updateUser({ data: meta || {} });
    if (authRes.error) throw authRes.error;
    return updateProfile({ name: displayName });
  }

  async function ensureFounderAdmin() {
    var sb = db();
    var session = await getSession();
    var profile = await getProfile();
    if (!sb || !session) return profile;
    if (!profile && isFounderEmail(session.user.email)) {
      var created = await sb.from("profiles").insert({
        id: session.user.id,
        email: session.user.email,
        name: "StoneForge",
        is_admin: true
      }).select("*").single();
      if (!created.error) return created.data;
      return profile;
    }
    if (!profile) return profile;
    if (!isFounderEmail(session.user.email) || profile.is_admin) return profile;
    var res = await sb.from("profiles").update({ is_admin: true }).eq("id", session.user.id).select("*").single();
    if (res.error) return profile;
    return res.data;
  }

  async function signUp(email, password, name) {
    var sb = db();
    var meta = {
      name: name || email.split("@")[0],
      alias: name || email.split("@")[0],
      anonymous: true,
      public_name: ""
    };
    var redirect = global.location && global.location.origin ? global.location.origin + "/spot.html" : undefined;
    var res = await sb.auth.signUp({
      email: email,
      password: password,
      options: { data: meta, emailRedirectTo: redirect }
    });
    if (res.error && redirect && /redirect/i.test(res.error.message || "")) {
      res = await sb.auth.signUp({
        email: email,
        password: password,
        options: { data: meta }
      });
    }
    if (res.error) raise(res.error);
    var user = res.data && res.data.user;
    var identities = user && user.identities;
    if (user && !res.data.session && Array.isArray(identities) && identities.length === 0) {
      throw new Error("That email already has an account. Sign in on Your Spot.");
    }
    return res.data;
  }

  async function signIn(email, password) {
    var sb = db();
    var res = await sb.auth.signInWithPassword({ email: email, password: password });
    if (res.error) raise(res.error);
    return res.data;
  }

  async function signOut() {
    var sb = db();
    if (!sb) return;
    await sb.auth.signOut();
  }

  async function joinWaitlist(email, name, referredBy) {
    var sb = db();
    // next position
    var countRes = await sb.from("waitlist").select("position", { count: "exact", head: false }).order("position", { ascending: false }).limit(1);
    var next = 2848;
    if (countRes.data && countRes.data[0] && countRes.data[0].position) {
      next = countRes.data[0].position + 1;
    }
    var code = Math.random().toString(36).slice(2, 10);
    var row = {
      email: email.trim().toLowerCase(),
      name: name || email.split("@")[0],
      position: next,
      referral_code: code,
      referred_by: referredBy || null
    };
    var existing = await sb.from("waitlist").select("*").eq("email", row.email).maybeSingle();
    if (existing.data) return existing.data;
    var ins = await sb.from("waitlist").insert(row).select("*").single();
    if (ins.error) throw ins.error;

    if (referredBy) {
      var bump = await sb.rpc("bump_referral", { code: referredBy });
      if (bump.error) {
        var ref = await sb.from("waitlist").select("*").eq("referral_code", referredBy).maybeSingle();
        if (ref.data) {
          await sb.from("waitlist").update({ position: Math.max(1, ref.data.position - 1) }).eq("id", ref.data.id);
        }
      }
    }

    await notifyWaitlist({
      type: "waitlist",
      email: ins.data.email,
      name: ins.data.name,
      position: ins.data.position,
      referralCode: ins.data.referral_code,
      referredBy: referredBy || "",
      source: "website",
      createdAt: new Date().toISOString()
    });

    return ins.data;
  }

  async function ensureSpot() {
    var sb = db();
    var session = await getSession();
    if (!sb || !session || !session.user || !session.user.email) return null;
    var profile = await ensureProfile();
    var email = String(session.user.email).trim().toLowerCase();
    var existing = await sb.from("waitlist").select("*").eq("email", email).maybeSingle();
    var row = existing.data;
    if (!row) {
      try {
        row = await joinWaitlist(email, (profile && profile.name) || null, null);
      } catch (e) {
        row = null;
      }
    }
    if (row && profile) {
      var patch = { waitlist_position: row.position };
      if (row.referral_code && profile.referral_code !== row.referral_code) patch.referral_code = row.referral_code;
      var updated = await sb.from("profiles").update(patch).eq("id", session.user.id).select("*").single();
      if (updated.error && patch.referral_code) {
        updated = await sb.from("profiles").update({ waitlist_position: row.position }).eq("id", session.user.id).select("*").single();
      }
      if (updated.data) profile = updated.data;
    }
    return { profile: profile, waitlist: row };
  }

  async function fetchPosts() {
    var sb = db();
    var postsRes = await sb.from("posts").select("*").order("created_at", { ascending: false });
    if (postsRes.error) raise(postsRes.error);
    var posts = postsRes.data || [];
    if (!posts.length) return [];

    var ids = posts.map(function (p) { return p.id; });
    var repliesRes = await sb.from("replies").select("*").in("post_id", ids).order("created_at", { ascending: true });
    var votesRes = await sb.from("post_votes").select("*").in("post_id", ids);

    var repliesBy = {};
    (repliesRes.data || []).forEach(function (r) {
      (repliesBy[r.post_id] = repliesBy[r.post_id] || []).push(r);
    });
    var votesBy = {};
    (votesRes.data || []).forEach(function (v) {
      (votesBy[v.post_id] = votesBy[v.post_id] || []).push(v);
    });

    return posts.map(function (p) {
      return Object.assign({}, p, {
        replies: repliesBy[p.id] || [],
        votes: votesBy[p.id] || []
      });
    });
  }

  async function createPost(type, title, body) {
    var sb = db();
    var session = await getSession();
    if (!session) throw new Error("Sign in required");
    var profile = await ensureProfile();
    var row = {
      author_id: session.user.id,
      author_name: (profile && profile.name) || session.user.email.split("@")[0],
      type: type,
      title: title,
      body: body
    };
    var res = await sb.from("posts").insert(row).select("*").single();
    if (res.error) raise(res.error);

    await notifyForum({
      type: type,
      title: title,
      body: body,
      author: row.author_name,
      email: session.user.email,
      createdAt: new Date().toISOString()
    });

    return res.data;
  }

  async function vote(postId, value) {
    var sb = db();
    var session = await getSession();
    if (!session) throw new Error("Sign in required");
    var existing = await sb.from("post_votes").select("*").eq("post_id", postId).eq("user_id", session.user.id).maybeSingle();
    if (existing.data && existing.data.value === value) {
      var del = await sb.from("post_votes").delete().eq("post_id", postId).eq("user_id", session.user.id);
      if (del.error) raise(del.error);
      return;
    }
    var upsert = await sb.from("post_votes").upsert({
      post_id: postId,
      user_id: session.user.id,
      value: value
    });
    if (upsert.error) raise(upsert.error);
  }

  async function adminReply(postId, body) {
    var sb = db();
    var session = await getSession();
    var profile = await getProfile();
    var founder = isFounderEmail(session && session.user && session.user.email);
    if (!session || !profile || (!profile.is_admin && !founder)) throw new Error("Admin only");
    var res = await sb.from("replies").insert({
      post_id: postId,
      author_id: session.user.id,
      author_name: "StoneForge",
      body: body,
      is_admin: true
    }).select("*").single();
    if (res.error) raise(res.error);

    await notifyForum({
      type: "admin-reply",
      title: "Admin replied",
      body: body,
      author: "StoneForge (admin)",
      email: session.user.email,
      createdAt: new Date().toISOString()
    });

    return res.data;
  }

  global.SFCloud = {
    enabled: enabled,
    db: db,
    notifyForum: notifyForum,
    notifyWaitlist: notifyWaitlist,
    getSession: getSession,
    getProfile: getProfile,
    ensureSpot: ensureSpot,
    updateProfile: updateProfile,
    setPublicIdentity: setPublicIdentity,
    ensureFounderAdmin: ensureFounderAdmin,
    isFounderEmail: isFounderEmail,
    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    joinWaitlist: joinWaitlist,
    fetchPosts: fetchPosts,
    createPost: createPost,
    vote: vote,
    adminReply: adminReply
  };
})(window);
