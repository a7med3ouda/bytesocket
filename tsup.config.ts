import { defineConfig } from "tsup";

export const baseConfig = defineConfig({
	format: ["esm", "cjs"],
	target: "es2022",
	dts: true,
	clean: true,
	minify: false,
	treeshake: true,
	sourcemap: true,
	splitting: false,
});
