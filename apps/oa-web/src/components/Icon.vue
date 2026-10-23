<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{ name: string; size?: number; strokeWidth?: number }>(), {
  size: 20,
  strokeWidth: 1.7,
})

const icons: Record<string, string[]> = {
  dashboard: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z'],
  inbox: ['M4 4h16l2 10v6H2v-6L4 4Z', 'M2 14h6l2 3h4l2-3h6'],
  check: ['m5 12 4 4L19 6'],
  file: ['M14 2H5v20h14V7l-5-5Z', 'M14 2v6h5', 'M8 12h8M8 16h6'],
  users: [
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    'M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  ],
  briefcase: ['M3 7h18v14H3z', 'M8 7V3h8v4', 'M3 12a23 23 0 0 0 18 0M12 11v4'],
  wallet: [
    'M20 8V3H5a3 3 0 0 0-3 3v13a2 2 0 0 0 2 2h16V8H5a2 2 0 0 1 0-4',
    'M20 11h-5v6h5M16.5 14h.01',
  ],
  chart: ['M3 3v18h18', 'M7 16v-5M12 16V6M17 16v-8'],
  settings: [
    'm9 3-.6 2.4-2 1.1L4 5.8 1.7 10l1.8 1.7v2.6L1.7 16 4 20.2l2.4-.7 2 1.1L9 23h6l.6-2.4 2-1.1 2.4.7 2.3-4.2-1.8-1.7v-2.6l1.8-1.7L20 5.8l-2.4.7-2-1.1L15 3H9Z',
    'M12 9a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  ],
  'chevron-right': ['m9 5 7 7-7 7'],
  'chevron-left': ['m15 5-7 7 7 7'],
  'chevron-down': ['m6 9 6 6 6-6'],
  search: ['M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Z', 'm16 16 5 5'],
  'arrow-right': ['M4 12h16m-6-6 6 6-6 6'],
  'arrow-up-right': ['M6 18 18 6M6 6h12v12'],
  refresh: ['M20 7v5h-5M4 17v-5h5', 'M6.1 6.1A8 8 0 0 1 19.7 10M4.3 14A8 8 0 0 0 18 18'],
  plus: ['M12 5v14M5 12h14'],
  external: ['M14 3h7v7M21 3 10 14', 'M10 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6'],
  link: [
    'm10 13 4-4',
    'M9 15H7a4 4 0 0 1-2.8-6.8l4-4A4 4 0 0 1 15 7v2M15 9h2a4 4 0 0 1 2.8 6.8l-4 4A4 4 0 0 1 9 17v-2',
  ],
  server: ['M3 3h18v7H3zM3 14h18v7H3z', 'M6 6.5h.01M6 17.5h.01M11 6.5h7M11 17.5h7'],
  lock: ['M5 10h14v11H5z', 'M8 10V6a4 4 0 0 1 8 0v4M12 14v3'],
  'log-out': ['M9 3H3v18h6M15 7l5 5-5 5M8 12h12'],
  close: ['m6 6 12 12M6 18 18 6'],
  'check-circle': ['M22 11.08V12a10 10 0 1 1-5.93-9.14', 'm22 4-10 10-3-3'],
  'alert-circle': ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z', 'M12 7v6M12 17h.01'],
  menu: ['M4 6h16M4 12h16M4 18h16'],
  clock: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z', 'M12 6v6l4 2'],
  filter: ['M4 5h16M7 12h10M10 19h4', 'M8 3v4M16 10v4M12 17v4'],
  building: ['M4 22V4h12v18M16 10h4v12M1 22h22M8 8h4M8 12h4M8 16h4M9 22v-3h2v3'],
  calendar: ['M3 5h18v16H3z', 'M7 2v6M17 2v6M3 10h18M7 14h2M13 14h2M7 17h2'],
  download: ['M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6'],
  bolt: ['m13 2-9 12h7l-1 8 10-13h-7l1-7Z'],
  shield: ['m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Z', 'm8 12 3 3 5-6'],
  layers: ['m12 2 10 5-10 5L2 7l10-5ZM2 12l10 5 10-5M2 17l10 5 10-5'],
  info: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z', 'M12 11v6M12 7h.01'],
  globe: [
    'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z',
    'M2 12h20M12 2a20 20 0 0 0 0 20 20 20 0 0 0 0-20Z',
  ],
  activity: ['M2 12h4l3-8 6 16 3-8h4'],
  sun: [
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
    'M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  ],
}
const paths = computed(() => icons[props.name] ?? icons.file)
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path v-for="(path, index) in paths" :key="index" :d="path" />
  </svg>
</template>
