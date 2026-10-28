import { esc, meshXml, NS_CORE, translate } from './threemf';
import type { Files, Scene } from './threemf';

const NS_SLIC3R = 'http://schemas.slic3r.org/3mf/2017/06';
const MATRIX = '1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1';

/**
 * PrusaSlicer: one mesh object per printed object holding every part's triangles, split into volumes by
 * triangle index in `Metadata/Slic3r_PE_model.config`, each volume on its extruder.
 */
export function prusaFiles(scene: Scene): Files {
  const objects: string[] = [], items: string[] = [], cfg: string[] = [];
  scene.objects.forEach((o, k) => {
    const id = k + 1;
    objects.push(`  <object id="${id}" type="model">\n${meshXml(o.parts.map((p) => p.mesh), '   ')}\n  </object>`);
    items.push(`  <item objectid="${id}" transform="${translate(o.at)}" printable="1"/>`);
    let first = 0;
    const volumes = o.parts.map((p) => {
      const last = first + p.mesh.triVerts.length / 3 - 1;
      const v = `  <volume firstid="${first}" lastid="${last}">
   <metadata type="volume" key="name" value="${esc(p.name)}"/>
   <metadata type="volume" key="volume_type" value="ModelPart"/>
   <metadata type="volume" key="matrix" value="${MATRIX}"/>
   <metadata type="volume" key="extruder" value="${p.slot}"/>
  </volume>`;
      first = last + 1;
      return v;
    });
    cfg.push(` <object id="${id}" instances_count="1">
  <metadata type="object" key="name" value="${esc(o.name)}"/>
${volumes.join('\n')}
 </object>`);
  });
  return {
    '3D/3dmodel.model': `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="${NS_CORE}" xmlns:slic3rpe="${NS_SLIC3R}">
 <metadata name="slic3rpe:Version3mf">1</metadata>
 <metadata name="Title">${esc(scene.name)}</metadata>
 <metadata name="Application">pixel3d</metadata>
 <resources>
${objects.join('\n')}
 </resources>
 <build>
${items.join('\n')}
 </build>
</model>
`,
    'Metadata/Slic3r_PE_model.config': `<?xml version="1.0" encoding="UTF-8"?>
<config>
${cfg.join('\n')}
</config>
`,
  };
}
