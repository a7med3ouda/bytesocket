import { defineConfig } from "tsdown";

export const baseConfig = defineConfig({
	format: ["esm", "cjs"],
	target: "es2024",
	dts: true,
	clean: true,
	minify: false,
	treeshake: true,
	sourcemap: true,
	fixedExtension: false,
});
