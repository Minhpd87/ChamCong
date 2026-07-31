import { useEffect } from 'react'

function applyLightTheme() {
  document.documentElement.classList.remove('dark')
  document.documentElement.classList.add('light')
  document.documentElement.setAttribute('data-theme', 'light')
  document.documentElement.style.colorScheme = 'light'
  window.localStorage.setItem('theme', 'light')
}

export default function ThemeToggle() {
  useEffect(() => {
    applyLightTheme()
  }, [])

  return (
    <button
      type="button"
      onClick={applyLightTheme}
      aria-label="Light theme enabled"
      title="Light theme enabled"
      className="rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1.5 text-sm font-semibold text-[var(--sea-ink)] shadow-[0_8px_22px_rgba(30,90,72,0.08)] transition hover:-translate-y-0.5"
    >
      Light
    </button>
  )
}
