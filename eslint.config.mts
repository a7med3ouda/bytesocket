import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";
import unusedImports from "eslint-plugin-unused-imports";
import prettier from "eslint-config-prettier";

export default defineConfig([
	js.configs.recommended,
	...tseslint.configs.strict,
	{
		files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
	},
	{
		files: ["**/*.{ts,js,mts,cts}"],
		plugins: { "unused-imports": unusedImports },
		rules: {
			"@typescript-eslint/no-unused-vars": "off",
			"@typescript-eslint/no-explicit-any": "warn",
			"unused-imports/no-unused-imports": "error",
			"unused-imports/no-unused-vars": [
				"error",
				{
					args: "all",
					vars: "all",
					argsIgnorePattern: "^_",
					caughtErrors: "all",
					caughtErrorsIgnorePattern: "^_",
					destructuredArrayIgnorePattern: "^_",
					varsIgnorePattern: "^_",
					ignoreRestSiblings: true,
				},
			],
		},
	},
	prettier,
	{
		ignores: ["**/dist", "**/node_modules"],
	},
]);
