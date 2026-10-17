# Production: down.livvux.dev

The app runs as a single Dokploy Compose deployment on the `dokploy` SSH host. Cloudflare proxies its DNS record to the host; Traefik terminates origin TLS using Let's Encrypt.

- Repository: `https://github.com/Livvux/getdown.git`, branch `main`.
- Dokploy project: `livvux`, environment `production`.
- Compose ID: `djOm4U3Agldx8LGaPZRKE`.
- Compose file: `compose.dokploy.yaml`.
- File-provider route: `/etc/dokploy/traefik/dynamic/getdown.yml`, sourced from `deploy/traefik.yml`. The host uses the Traefik file provider; Dokploy domain metadata alone does not create a working route.

Deploy a tested commit with:

```sh
dokploy compose deploy --composeId djOm4U3Agldx8LGaPZRKE --title "Deploy getdown"
```

Only `ingress` joins `dokploy-network`, with the stable alias `getdown-ingress`. The application has an internal-only Docker network. yt-dlp uses the dedicated HTTP proxy, which denies private, loopback, link-local, Tailscale and reserved destination addresses. The proxy has no published ports or access logging. Do not attach `app` to an external network or remove the destination ACLs.

The launch limits are one active download, four queued jobs, 100 MB per file, 30-minute media duration, ten-minute job timeout and 15-minute retention. Download storage is a 1 GiB tmpfs and is discarded on restart; jobs are also in memory. The app has a 2 GiB memory limit. No credentials or user cookies are passed to yt-dlp. The trusted Blender download server and Mux test-stream server are additionally allowed for reproducible public-media acceptance checks.

Rate limits are intentionally global (30 previews and 12 jobs/minute). `TRUST_PROXY_HEADERS=0` stays in place until a trusted end-to-end client-IP chain is configured. Never enable it just to increase capacity.

After deployment, verify:

1. `https://down.livvux.dev/` and `/api/health` return 200 through Cloudflare.
2. A permitted public media URL can be inspected, downloaded and saved; validate the result with FFprobe.
3. From the app container, direct public internet access fails, proxy access to public HTTPS works, and proxy requests to private/loopback/link-local destinations return 403.
4. Verify the public UI on desktop and mobile, including console/network errors.

No automatic release claim follows from a Git push. Check the Dokploy deployment status and the live app explicitly. Downloads already running are interrupted by recreation; redeploy when the queue is idle.

Third-party availability is separate from deployment health. The tested YouTube URL requested bot verification from this VPS, and the tested Vimeo URL required login. The app deliberately has no user-cookie or login bypass.

## Mullvad egress through the existing Tailscale host

The `outbound` network is fixed to `192.168.240.0/28` (`getdown-mullvad-egress`). Only this source subnet uses Tailscale's selected Mullvad exit. Other host/container data traffic keeps the main routing table; more-specific tailnet routes are retained. The existing host must have Mullvad access in Tailscale.

Install the host files before deploying this Compose network (as root):

```sh
install -m 755 deploy/getdown-mullvad.sh /usr/local/sbin/getdown-mullvad
install -m 644 deploy/getdown-mullvad.nft /etc/getdown-mullvad.nft
install -m 644 deploy/getdown-mullvad.service deploy/getdown-mullvad-firewall.service /etc/systemd/system/
mkdir -p /etc/systemd/system/docker.service.d /etc/systemd/system/tailscaled.service.d
install -m 644 deploy/getdown-mullvad-docker.conf /etc/systemd/system/docker.service.d/getdown-mullvad.conf
install -m 644 deploy/getdown-mullvad-tailscaled.conf /etc/systemd/system/tailscaled.service.d/getdown-mullvad.conf
printf '%s\n' 'MULLVAD_EXIT_NODE=100.117.47.8' > /etc/getdown-mullvad.conf
systemctl daemon-reload
systemctl enable --now getdown-mullvad-firewall.service
systemctl enable --now getdown-mullvad.service
```

Managed exit ownership persists under `/var/lib/getdown-mullvad`; host-preserving policy rules are restored before Tailscale starts after an unclean reboot. The independent nftables forwarding guard starts before Docker, so automatic container restarts cannot leak direct traffic. Stopping the VPN service leaves this guard installed and downloads fail closed. `getdown-mullvad rollback` restores host exit-node selection and removes owned policy routes/NAT; it deliberately retains the forwarding guard. Do not delete the guard while the proxy is attached to this network. The script refuses exit-node selections not owned by this installation. Routing priorities 5260–5264 are reserved for this service; check they are unused before first installation.

Before changing the selected exit, schedule a short systemd rollback timer and verify a fresh SSH connection, host public IP, public health, host/tailnet DNS, and an unrelated container. Cancel the timer only after verification. Quad100 DNS belongs to the shared host identity and can follow Tailscale exit-node DNS behavior; source policy routing isolates data traffic, not a separate DNS identity.
