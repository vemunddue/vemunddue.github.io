# vemunddue.com

A design system having a bad day. Plain HTML, CSS and JS, no build step.

## Run locally

```bash
python3 -m http.server 4321
```

## Deploy (GitHub Pages, free)

1. Push this folder to a GitHub repo.
2. Settings → Pages → Source: "Deploy from a branch", `main` / root.
3. Custom domain: `vemunddue.com` (the `CNAME` file already says so), then tick "Enforce HTTPS".

## DNS at one.com

- Turn off the default A records for `vemunddue.com` and `www`.
- A `@` → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
- CNAME `www` → `<github-username>.github.io`
- Leave MX alone if mail goes through one.com.
