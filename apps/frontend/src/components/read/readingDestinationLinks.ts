/** Supporting Media collection and guide-group links share this quiet palette. */
export const READING_DESTINATION_LINK_COLOR = '#4b524b';

export const readingDestinationLinkStates = `
.read-collection-link,.read-collection-link:visited,[data-set-page-link],[data-set-page-link]:visited{color:${READING_DESTINATION_LINK_COLOR}}
[data-set-page-link] [data-set-page-words]{color:inherit}
@media(min-width:768px) and (hover:hover) and (pointer:fine){
  .read-collection-link:hover,[data-set-page-link]:hover{color:#11150f}
  .read-collection-link:hover .read-collection-link-label,[data-set-page-link]:hover [data-set-page-words]{text-decoration:underline}
}
.read-collection-link:active,[data-set-page-link]:active{color:#11150f}
.read-collection-link:active .read-collection-link-label,[data-set-page-link]:active [data-set-page-words]{text-decoration:underline}
`;
