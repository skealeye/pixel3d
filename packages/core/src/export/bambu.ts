import { esc, IDENTITY, MATRIX, meshXml, NS_BAMBU, NS_CORE, NS_PROD, pauseAt, relsXml, translate } from './xml';
import type { Files, Scene } from './xml';

/**
 * Bambu Studio (and Orca Slicer, which reads the same files) project metadata, laid out as Bambu Studio 1.x
 * writes it: `3D/3dmodel.model` holds one assembly object per printed object, whose components point
 * (production extension `p:path`) at mesh objects in `3D/Objects/object_<k>.model`, one per part.
 * `Metadata/model_settings.config` puts each part on its filament slot; `project_settings.config` sets the
 * slot colors; `custom_gcode_per_layer.xml` pauses for sealed magnets.
 */

/** Claim a released Bambu Studio version so the file is read as a Bambu project, not geometry only. */
const APP = 'BambuStudio-01.09.00.00';
const VERSION = '01.09.00.00';
/**
 * A Bambu system printer preset. Without one Bambu Studio treats the file's printer as an unnamed custom preset:
 * it warns about "customized presets" (listing "-") and can pick a 0.2 mm nozzle. The X1 Carbon 0.4 is the user's
 * printer; any system name clears the warning, and the user can switch printer after opening.
 */
const PRINTER = 'Bambu Lab X1 Carbon';
const NOZZLE = '0.4';

const hex = (n: number, w: number) => n.toString(16).padStart(w, '0');
const uuid = (n: number, tail: string) => `${hex(n, 8)}-${tail}`;
const OBJ = '61cb-4c03-9d28-80fed5dfa1dc', COMP = 'b206-40ff-9872-83e8017abed1', ITEM = 'b1ec-4553-aec9-835e5b724bb4';

const header = (extra = '') => `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="${NS_CORE}" xmlns:BambuStudio="${NS_BAMBU}" xmlns:p="${NS_PROD}" requiredextensions="p">
${extra} <metadata name="BambuStudio:3mfVersion">1</metadata>`;

export function bambuFiles(scene: Scene): Files {
  const files: Files = {};
  const assemblies: string[] = [], items: string[] = [], paths: string[] = [];
  const cfgObjects: string[] = [], instances: string[] = [], assemble: string[] = [];
  let id = 1;
  scene.objects.forEach((o, k) => {
    const path = `/3D/Objects/object_${k + 1}.model`;
    paths.push(path);
    const partIds = o.parts.map(() => id++);
    const objId = id++;
    // the parts' meshes, in the object's frame
    files[path.slice(1)] = `${header()}
 <resources>
${o.parts.map((p, i) => `  <object id="${partIds[i]}" p:UUID="${uuid(partIds[i]!, OBJ)}" type="model">\n${meshXml([p.mesh], '   ')}\n  </object>`).join('\n')}
 </resources>
 <build/>
</model>
`;
    assemblies.push(`  <object id="${objId}" p:UUID="${uuid(objId, OBJ)}" type="model">
   <components>
${partIds.map((pid, i) => `    <component p:path="${path}" objectid="${pid}" p:UUID="${hex(objId, 4)}${hex(i, 4)}-${COMP}" transform="${IDENTITY}"/>`).join('\n')}
   </components>
  </object>`);
    const t = translate(o.at);
    items.push(`  <item objectid="${objId}" p:UUID="${uuid(objId, ITEM)}" transform="${t}" printable="1"/>`);
    cfgObjects.push(`  <object id="${objId}">
    <metadata key="name" value="${esc(o.name)}"/>
    <metadata key="extruder" value="1"/>
${o.parts.map((p, i) => `    <part id="${partIds[i]}" subtype="normal_part">
      <metadata key="name" value="${esc(p.name)}"/>
      <metadata key="matrix" value="${MATRIX}"/>
      <metadata key="extruder" value="${p.slot}"/>
      <mesh_stat edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>
    </part>`).join('\n')}
  </object>`);
    instances.push(`    <model_instance>
      <metadata key="object_id" value="${objId}"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="${100 + objId}"/>
    </model_instance>`);
    assemble.push(`   <assemble_item object_id="${objId}" instance_id="0" transform="${t}" offset="0 0 0" />`);
  });

  files['3D/3dmodel.model'] = `${header(` <metadata name="Application">${APP}</metadata>\n`)}
 <metadata name="Title">${esc(scene.name)}</metadata>
 <resources>
${assemblies.join('\n')}
 </resources>
 <build p:UUID="2c7c17d8-22b5-4d84-8835-1976022ea369">
${items.join('\n')}
 </build>
</model>
`;
  files['3D/_rels/3dmodel.model.rels'] = relsXml(paths);
  files['Metadata/model_settings.config'] = `<?xml version="1.0" encoding="UTF-8"?>
<config>
${cfgObjects.join('\n')}
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value=""/>
    <metadata key="locked" value="false"/>
${instances.join('\n')}
  </plate>
  <assemble>
${assemble.join('\n')}
  </assemble>
</config>
`;
  const n = scene.colors.length, each = <T>(v: T) => Array.from({ length: n }, () => v);
  files['Metadata/project_settings.config'] = JSON.stringify({
    name: 'project_settings',
    from: 'project',
    version: VERSION,
    printer_model: PRINTER,
    printer_settings_id: `${PRINTER} ${NOZZLE} nozzle`,
    printer_variant: NOZZLE, // re-picking a printer model keeps the 0.4 mm nozzle preset
    filament_colour: scene.colors, // external format key, spelling fixed by Bambu Studio
    filament_type: each('PLA'),
    filament_settings_id: each('Generic PLA'),
    filament_diameter: each('1.75'),
    nozzle_diameter: [NOZZLE],
    layer_height: '0.2',
  }, null, 4) + '\n';
  if (scene.pauseZ.length) {
    files['Metadata/custom_gcode_per_layer.xml'] = `<?xml version="1.0" encoding="utf-8"?>
<custom_gcodes_per_layer>
<plate>
<plate_info id="1"/>
${scene.pauseZ.map((z) => `<layer top_z="${pauseAt(z)}" type="1" extruder="1" color="" extra="" gcode="M400 U1"/>`).join('\n')}
<mode value="MultiAsSingle"/>
</plate>
</custom_gcodes_per_layer>
`;
  }
  return files;
}
