export interface ChangelogEntry {
  version: string
  title: string
  date: string
  points: string[]
}

export const CHANGELOG_ENTRIES: ChangelogEntry[] = [
  {
    version: 'v0.1.24',
    title: 'Board Switch Cache and Updater Fixes',
    date: 'March 19, 2026',
    points: [
      'Preserved cached browser webviews across board switches so recent tabs stay warm.',
      'Fixed manual update checks so the updater reports new releases correctly.',
      'Set the webview allowpopups attribute explicitly to avoid React warnings.'
    ]
  },
  {
    version: 'v0.1.23',
    title: 'Theme Preset Menu Fix',
    date: 'March 19, 2026',
    points: [
      'Fixed theme preset dropdown click handling.'
    ]
  },
  {
    version: 'v0.1.22',
    title: 'Theme Presets and Customization',
    date: 'March 19, 2026',
    points: [
      'Added theme presets with color customization, font selection, and improved contrast.'
    ]
  },
  {
    version: 'v0.1.21',
    title: 'Popup Window and Tab Chrome',
    date: 'March 19, 2026',
    points: [
      'Improved popup window behavior and tab bar refinements.',
      'Added inline tab bar layout with traffic lights when the sidebar is collapsed.',
      'Added tab reload support and polished the workspace and view switchers.'
    ]
  },
  {
    version: 'v0.1.20',
    title: 'Folder and Tabs Chrome',
    date: 'March 19, 2026',
    points: [
      'Streamlined folder and tabs chrome across the browser workspace.'
    ]
  },
  {
    version: 'v0.1.19',
    title: 'Sidebar Menus and Context Actions',
    date: 'March 18, 2026',
    points: [
      'Replaced board sidebar action buttons with a menu dropdown and context menu.'
    ]
  },
  {
    version: 'v0.1.18',
    title: 'Same-Type Tab Creation',
    date: 'March 18, 2026',
    points: [
      'Cmd+T now opens the same kind of tab as the currently active item.'
    ]
  },
  {
    version: 'v0.1.17',
    title: 'Release v0.1.17',
    date: 'March 16, 2026',
    points: []
  },
  {
    version: 'v0.1.16',
    title: 'Favicon Fallbacks',
    date: 'March 16, 2026',
    points: [
      'Improved browser favicon fallback behavior.'
    ]
  },
  {
    version: 'v0.1.15',
    title: 'Tab Close Buttons and Notifications',
    date: 'March 16, 2026',
    points: [
      'Added tab close buttons directly in the tab bar.',
      'Improved agent naming and notification badges.',
      'Expanded release work around terminals and desktop packaging.'
    ]
  },
  {
    version: 'v0.1.14',
    title: 'Release v0.1.14',
    date: 'March 15, 2026',
    points: []
  },
  {
    version: 'v0.1.13',
    title: 'Board Ordering and Sidebar Tab UX',
    date: 'March 15, 2026',
    points: [
      'Improved board tab ordering and sidebar actions.',
      'Added active tab highlight in the sidebar and improved tab item sizing.'
    ]
  },
  {
    version: 'v0.1.12',
    title: 'Tab Selection and Sidebar Polish',
    date: 'March 15, 2026',
    points: [
      'Refactored tab selection behavior and hid the sidebar scrollbar.'
    ]
  },
  {
    version: 'v0.1.11',
    title: 'Terminal Interactions and Update Banner Move',
    date: 'March 11, 2026',
    points: [
      'Improved terminal interactions.',
      'Moved update notifications from the top banner into the sidebar.'
    ]
  },
  {
    version: 'v0.1.10',
    title: 'Keyboard and Board-Switch Fixes',
    date: 'March 6, 2026',
    points: [
      'Allowed Ctrl+Tab and Ctrl+Shift+Tab to cycle tabs while a terminal is active.',
      'Prevented the board-switch effect from firing on every settings change.',
      'Prevented Cmd/Ctrl+W from closing the Electron window.'
    ]
  },
  {
    version: 'v0.1.9',
    title: 'Board Icons and Restored Tab Selection',
    date: 'March 6, 2026',
    points: [
      'Restored the last selected tab when switching boards.',
      'Added custom icons and colors for folders and boards.'
    ]
  },
  {
    version: 'v0.1.8',
    title: 'Settings Update Checks',
    date: 'March 6, 2026',
    points: [
      'Added a check-for-updates button in Settings.'
    ]
  },
  {
    version: 'v0.1.7',
    title: 'Static Terminal Previews',
    date: 'March 5, 2026',
    points: [
      'Replaced live terminal previews on nodes with static screenshots.'
    ]
  },
  {
    version: 'v0.1.6',
    title: 'Unsigned Build Fallback',
    date: 'March 4, 2026',
    points: [
      'Skipped code signing automatically when the CSC_LINK secret is not configured.'
    ]
  },
  {
    version: 'v0.1.5',
    title: 'Terminal, Rename Dialog, and Notarization Work',
    date: 'March 4, 2026',
    points: [
      'Shipped terminal improvements and the node rename dialog.',
      'Added tab cycling shortcuts.',
      'Expanded notarization and desktop release work.'
    ]
  }
]
