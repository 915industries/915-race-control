/*
 * Race Control Nexus Theme
 * A cinematic dark theme with deep blues.  Designed for promotional demos
 * and general brand identity.  Blue accent pops against the dark backdrop.
 */
:root {
  --bg-color: #0e1b2c;
  --fg-color: #e8eef8;
  --accent-color: #4285f4;
  --secondary-color: #162a40;
}

body {
  background-color: var(--bg-color);
  color: var(--fg-color);
  font-family: 'Arial', sans-serif;
  margin: 0;
  padding: 0;
}

#settingsBtn {
  position: fixed;
  top: 0.5rem;
  right: 0.5rem;
  background: var(--secondary-color);
  border: none;
  color: var(--fg-color);
  font-size: 1.5rem;
  padding: 0.2rem 0.6rem;
  border-radius: 0.25rem;
  cursor: pointer;
  z-index: 1000;
}

#themeMenu {
  position: fixed;
  top: 2.5rem;
  right: 0.5rem;
  background: var(--secondary-color);
  border: 1px solid var(--accent-color);
  padding: 0.5rem;
  border-radius: 0.25rem;
  z-index: 999;
  color: var(--fg-color);
}

#themeMenu h3 {
  margin-top: 0;
  margin-bottom: 0.5rem;
}

#themeMenu ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

#themeMenu li {
  padding: 0.25rem 0.5rem;
  cursor: pointer;
}

#themeMenu li:hover {
  background-color: var(--accent-color);
  color: var(--bg-color);
}