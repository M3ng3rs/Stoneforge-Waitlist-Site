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

  async function getProfile() {
    var sb = db();
    var session = await getSession();
    if (!sb || !session) return null;
    var res = await sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
    return res.data || null;
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
    var res = await sb.auth.signUp({
      email: email,
      password: password,
      options: { data: { name: name || email.split("@")[0], alias: name || email.split("@")[0], anonymous: true, public_name: "" } }
    });
    if (res.error) throw res.error;
    return res.data;
  }

  async function signIn(email, password) {
    var sb = db();
    var res = await sb.auth.signInWithPassword({ email: email, password: password });
    if (res.error) throw res.error;
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
      var ref = await sb.from("waitlist").select("*").eq("referral_code", referredBy).maybeSingle();
      if (ref.data) {
        await sb.from("waitlist").update({ position: Math.max(1, ref.data.position - 1) }).eq("id", ref.data.id);
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

  async function fetchPosts() {
    var sb = db();
    var postsRes = await sb.from("posts").select("*").order("created_at", { ascending: false });
    if (postsRes.error) throw postsRes.error;
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
    var profile = await getProfile();
    var row = {
      author_id: session.user.id,
      author_name: (profile && profile.name) || session.user.email.split("@")[0],
      type: type,
      title: title,
      body: body
    };
    var res = await sb.from("posts").insert(row).select("*").single();
    if (res.error) throw res.error;

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
      if (del.error) throw del.error;
      return;
    }
    var upsert = await sb.from("post_votes").upsert({
      post_id: postId,
      user_id: session.user.id,
      value: value
    });
    if (upsert.error) throw upsert.error;
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
    if (res.error) throw res.error;

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
