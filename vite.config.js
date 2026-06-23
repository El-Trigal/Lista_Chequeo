import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "mvp-checklist-aspersion";

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? `/${repositoryName}/` : "/",
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  plugins: [react()]
});
