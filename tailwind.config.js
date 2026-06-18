/** @type {import('tailwindcss').Config} */
export default {
	content: ["./src/**/*.{html,js,ts,svelte}"], // Scans SvelteKit files for layout styles
	darkMode: "class",
	theme: {
		extend: {
			colors: {
				"neon-blue": "#00d2ff", // Your custom crisp highlights
			},
		},
	},
	plugins: [],
};
