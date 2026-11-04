// The Git logomark, exactly as published on the official Git logo page
// (https://git-scm.com/community/logos): "Black logomark for light backgrounds"
// and "White logomark for dark backgrounds". Path data, transform, viewBox and
// fills are copied verbatim from those SVG files; do not edit them.
//
// Git Logo by Jason Long is licensed under the Creative Commons Attribution 3.0
// Unported License (https://creativecommons.org/licenses/by/3.0/). Git and the
// Git logo are either registered trademarks or trademarks of Software Freedom
// Conservancy, Inc., corporate home of the Git Project, in the United States
// and/or other countries. See ./NOTICE.md.

export const GIT_MARK = Object.freeze({
  name: 'Git logomark',
  owner: 'Software Freedom Conservancy, Inc. (Git Project); artwork by Jason Long',
  viewBox: '0 0 78 78',
  transform: 'translate(10 10) rotate(-45 29 29)',
  path: 'M5,58c-2.76142,0 -5,-2.23858 -5,-5v-48c0,-2.76142 2.23858,-5 5,-5h33v12.54404c-2.06553,0.94801 -3.5,3.03446 -3.5,5.45596c0,0.73514 0.13221,1.43941 0.37415,2.09031l-15.28384,15.28384c-0.6509,-0.24194 -1.35517,-0.37415 -2.09031,-0.37415c-3.31371,0 -6,2.68629 -6,6c0,3.31371 2.68629,6 6,6c3.31371,0 6,-2.68629 6,-6c0,-0.73514 -0.13221,-1.43941 -0.37415,-2.09031l14.87415,-14.87415l0,11.50851c-2.06553,0.94801 -3.5,3.03446 -3.5,5.45596c0,3.31371 2.68629,6 6,6c3.31371,0 6,-2.68629 6,-6c0,-2.42149 -1.43447,-4.50795 -3.5,-5.45596l0,-12.08808c2.06553,-0.94801 3.5,-3.03446 3.5,-5.45596c0,-2.42149 -1.43447,-4.50795 -3.5,-5.45596l0,-12.54404h10c2.76142,0 5,2.23858 5,5v48c0,2.76142 -2.23858,5 -5,5z',
  variants: Object.freeze({
    black: Object.freeze({ fill: '#100f0d', source: 'https://git-scm.com/images/logos/downloads/Git-Icon-Black.svg' }),
    white: Object.freeze({ fill: '#fff', source: 'https://git-scm.com/images/logos/downloads/Git-Icon-White.svg' }),
  }),
});
