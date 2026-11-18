# 2022 Minnesota Congressional and Legislative Districts

Sources: [Minnesota Congressional Districts](https://gis.lcc.mn.gov/metadata/cong22.htm),
[Minnesota House Districts](https://gis.lcc.mn.gov/metadata/L2022.html), and
[Minnesota Senate Districts](https://gis.lcc.mn.gov/metadata/S2022.htm), published
by the Minnesota Legislative Coordinating Commission GIS Office. The legislative
district files contain the May 26, 2023 corrections to the 2022 districts.

The Geographic Information System (GIS) Data to which this notice is attached are
made available pursuant to the Minnesota Government Data Practices Act (Minnesota
Statutes Chapter 13). THE GIS DATA ARE PROVIDED TO YOU AS IS AND WITHOUT ANY
WARRANTY AS TO THEIR PERFORMANCE, MERCHANTABILITY, OR FITNESS FOR ANY PARTICULAR
PURPOSE. The GIS Data were developed by the LCC - GIS Office for its own internal
business purposes.

The LCC - GIS Office does not represent or warrant that the GIS Data or the data
documentation are error-free, complete, current, or accurate. You are responsible
for any consequences resulting from your use of the GIS Data or your reliance on the
GIS Data. You should consult the data documentation for this particular GIS Data to
determine the limitations of the GIS Data and the precision with which the GIS Data
may depict distance, direction, location, or other geographic features.

If you transmit or provide the GIS Data (or any portion of it) to another user, the
GIS Data must include a copy of this disclaimer.

## November 3, 2026 Minnesota general election

The archived candidate lookup uses Minnesota's September 18 voting precinct
boundaries and the November 3 results precinct register. The Secretary of State
advises checking with the city, township or county for definitive precinct lines.
[Precinct map and use conditions](https://www.arcgis.com/sharing/rest/content/items/6c2c813b33144d49ba993bd86b3a58ba/info/metadata/metadata.xml?format=default&output=html)
and [election precinct register](https://electionresultsfiles.sos.mn.gov/20261103/PrctTbl.txt).

South St. Paul school boundaries come from Dakota County and the city's published
ballot styles. Crow Wing County school assignments cover municipalities with one
school district in both dated county tax-area registers.
[Dakota County school districts](https://gis2.co.dakota.mn.us/arcgis/rest/services/DCGIS_OL_Schools/MapServer/1),
[South St. Paul election ballots](https://www.southstpaulmn.gov/224/Elections),
[Crow Wing County 2026 register](https://www.crowwing.gov/Archive/ViewFile/Item/3159)
and [October 28, 2026 register](https://www.crowwing.gov/Archive/ViewFile/Item/3321).

The Secretary of State's dated precinct workbook supplies hospital districts.
Hennepin County's 2026 and proposed 2027 tax-area registers support single-school
municipalities. Minneapolis publishes matching park and school board districts.
[September precinct workbook](https://sos.mn.gov/media/3338/precinct-table.xlsx),
[Hennepin County registers](https://www.hennepincounty.gov/services/property/property-taxes/taxing-district-information)
and [Minneapolis election maps](https://vote.minneapolismn.gov/results-data/election-maps/).

For other schools, Minnesota's statewide 2025–26 school district map is one
part of the check. The 4 districts consolidated on July 1, 2026 are mapped to
their 2 successors. A match also requires the name and number assigned to the
same address range by the Secretary of State, and a school contest in the
November 3 precinct returns. Without an exact building location, all matching
street segments or the whole precinct must be inside one school district. The education map generalizes
some boundaries and is provided without warranty.
[Education map and data limitations](https://www.arcgis.com/sharing/rest/content/items/796cba407b014bfcae4d5f0050dd4c68/info/metadata/metadata.xml?format=default&output=html),
[2026 consolidations](https://www.house.mn.gov/hrd/issinfo/schdistcon.aspx),
[November school names by county](https://electionresultsfiles.sos.mn.gov/20261103/SchoolDistTbl.txt)
and [state address lookup](https://myballotmn.sos.mn.gov/).

The U.S. Census Bureau's October 6, 2026 TIGER/Line files supply legal township
boundaries inside Nashwauk and street address ranges across all 87 counties.
The street builder first checks whether the full segment clears the relevant
boundary by 10 metres. When it does not, the Census assigns each side's house
numbers to a specific polygon (a topological face). The entire face must
fit within one district, with at most 10 centimetres of linework difference.
All compatible records must agree for the address. Aliases in the address
range file have an explicit Census link to the side's house-number range.
[Minnesota county subdivisions](https://www2.census.gov/geo/tiger/TIGER2026/COUSUB/tl_2026_27_cousub.zip),
[county address ranges](https://www2.census.gov/geo/tiger/TIGER2026/ADDRFEAT/),
[Census topological faces](https://www2.census.gov/geo/tiger/TIGER2026/FACES/),
and [street range builder](../../../scripts/build_2026_candidate_streets.py).

The street index also includes mapped physical addresses and coordinates from
the Minnesota Department of Education's 2025–26 public school program
directory. They identify buildings. Electoral geography is checked separately.
[School program locations](https://operations.gis.data.mn.gov/api/publicdownload/download/1148/school_program_locations.csv)
(SHA-256 `a2deaa62a20469931669fe7e318613e6746bae22e614beee33f365810f6248de`).
