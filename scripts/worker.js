/**
 * VRC Time Tracker — Cloudflare Worker
 * 
 * This acts as a secure proxy between your static website, VRChat API, and GitHub Actions.
 * It holds your credentials in environment secrets so they are never exposed to the public.
 * 
 * Instructions:
 * 1. Go to dash.cloudflare.com -> Workers & Pages -> Create Worker
 * 2. Paste this code into the editor
 * 3. Add the following Secrets to your Worker:
 *    - VRCHAT_USERNAME (Your bot account username)
 *    - VRCHAT_PASSWORD (Your bot account password)
 *    - GITHUB_TOKEN (A Fine-grained Personal Access Token with Actions Read/Write permissions)
 *    - GITHUB_REPO (e.g. rohanC-dev/vrc-time-tracker)
 */

export default {
  async fetch(request, env, ctx) {
    // 1. Handle CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json"
    };

    try {
      // 2. SEARCH ENDPOINT: Proxy to VRChat API
      if (url.pathname === "/search" && request.method === "GET") {
        const query = url.searchParams.get("q");
        if (!query) {
          return new Response(JSON.stringify({ error: "Missing query" }), { status: 400, headers: corsHeaders });
        }

        // Authenticate with VRChat
        const authHeader = "Basic " + btoa(`${env.VRCHAT_USERNAME}:${env.VRCHAT_PASSWORD}`);
        
        // We use a custom User-Agent to avoid blocks
        const userAgent = "VRCTimeTrackerWorker/1.0.0 (contact: your-email@example.com)";

        const loginRes = await fetch("https://api.vrchat.cloud/api/1/auth/user", {
          headers: {
            "Authorization": authHeader,
            "User-Agent": userAgent
          }
        });

        if (!loginRes.ok) {
          return new Response(JSON.stringify({ error: "VRChat login failed" }), { status: 500, headers: corsHeaders });
        }

        // Extract the auth cookie
        const setCookieHeader = loginRes.headers.get("set-cookie") || "";
        const authCookieMatch = setCookieHeader.match(/auth=([^;]+)/);
        const authCookie = authCookieMatch ? authCookieMatch[0] : "";

        // Search Users
        const searchRes = await fetch(`https://api.vrchat.cloud/api/1/users?search=${encodeURIComponent(query)}&n=10`, {
          headers: {
            "Cookie": authCookie,
            "User-Agent": userAgent
          }
        });

        if (!searchRes.ok) {
          return new Response(JSON.stringify({ error: "VRChat search failed" }), { status: 500, headers: corsHeaders });
        }

        const data = await searchRes.json();
        
        // Format the response for our frontend
        const formattedData = data.map(u => ({
          id: u.id,
          displayName: u.displayName,
          avatarUrl: u.currentAvatarThumbnailImageUrl || "",
          profilePicUrl: u.profilePicOverride || u.currentAvatarThumbnailImageUrl || "",
          statusDescription: u.statusDescription || "",
          state: u.state || "offline"
        }));

        return new Response(JSON.stringify(formattedData), { status: 200, headers: corsHeaders });
      }

      // 3. TRACK ENDPOINT: Trigger GitHub Action
      if (url.pathname === "/track" && request.method === "POST") {
        const body = await request.json();
        const username = body.username;

        if (!username) {
          return new Response(JSON.stringify({ error: "Missing username" }), { status: 400, headers: corsHeaders });
        }

        // Dispatch the "Add User" workflow on GitHub
        const githubRes = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/add-user.yml/dispatches`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
            "Accept": "application/vnd.github+json",
            "User-Agent": "VRCTimeTrackerWorker",
            "X-GitHub-Api-Version": "2022-11-28"
          },
          body: JSON.stringify({
            ref: "master",
            inputs: { username: username }
          })
        });

        if (!githubRes.ok) {
          const errText = await githubRes.text();
          return new Response(JSON.stringify({ error: `GitHub Action failed: ${errText}` }), { status: 500, headers: corsHeaders });
        }

        return new Response(JSON.stringify({ success: true, message: "Tracking started" }), { status: 200, headers: corsHeaders });
      }

      return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: corsHeaders });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
  }
};
