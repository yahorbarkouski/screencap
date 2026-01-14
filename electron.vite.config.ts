import { execSync } from "node:child_process";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import type { Plugin } from "vite";

const devCsp =
	"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: file: local-file: https://i.scdn.co https://*.mzstatic.com; connect-src 'self' ws://localhost:* http://localhost:*; base-uri 'none'; object-src 'none'";

const prodCsp =
	"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: file: local-file: https://i.scdn.co https://*.mzstatic.com; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";

function cspPlugin(csp: string): Plugin {
	return {
		name: "csp",
		transformIndexHtml(html) {
			return html.replace('content="__CSP__"', `content="${csp}"`);
		},
	};
}

function getGitSha(): string | undefined {
	try {
		return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
	} catch {
		return undefined;
	}
}

function getBuildDate(): string {
	return new Date().toISOString().split("T")[0];
}

export default defineConfig(({ command }) => {
	const csp = command === "serve" ? devCsp : prodCsp;
	const isProd = command === "build";

	const buildDefines = {
		__BUILD_DATE__: isProd ? JSON.stringify(getBuildDate()) : "undefined",
		__GIT_SHA__: isProd ? JSON.stringify(getGitSha()) : "undefined",
		__RELEASE_CHANNEL__: JSON.stringify(
			process.env.RELEASE_CHANNEL || "stable",
		),
	};

	return {
		main: {
			plugins: [externalizeDepsPlugin()],
			define: buildDefines,
			build: {
				lib: {
					entry: resolve(__dirname, "electron/main/index.ts"),
				},
				rollupOptions: {
					external: ["better-sqlite3", "sharp"],
				},
			},
		},
		preload: {
			plugins: [externalizeDepsPlugin()],
			build: {
				lib: {
					entry: resolve(__dirname, "electron/preload/index.ts"),
					formats: ["cjs"],
				},
				rollupOptions: {
					output: {
						entryFileNames: "[name].cjs",
					},
				},
			},
		},
		renderer: {
			root: ".",
			build: {
				rollupOptions: {
					input: resolve(__dirname, "index.html"),
				},
			},
			resolve: {
				alias: {
					"@": resolve(__dirname, "src"),
				},
			},
			plugins: [react(), cspPlugin(csp)],
		},
	};
});
