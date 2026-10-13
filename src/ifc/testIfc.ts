/**
 * A small synthetic IFC4 file for the tests (written here, never the architect's model): boxes as extruded rectangle
 * profiles, placed at (x, y, z) in the IFC frame (Z up, metres).
 */
export interface TestBox {
  type: 'IFCWALL' | 'IFCSLAB' | 'IFCWINDOW' | 'IFCDOOR' | 'IFCCOLUMN' | 'IFCSPACE';
  at: [number, number, number];
  size: [number, number, number];
  /** IfcSlab / IfcWall predefined type, e.g. 'ROOF'. */
  predefined?: string;
  /** Contained in a storey at this elevation (one IfcBuildingStorey per elevation). */
  storey?: number;
}

const n = (v: number) => (Number.isInteger(v) ? `${v}.` : String(v));

/** `unit` 'MILLI' writes the file in millimetres (every length × 1000); the boxes and storeys are still given in metres. */
export function testIfc(boxes: TestBox[], opts: { unit?: 'MILLI' } = {}): string {
  const lines: string[] = [
    '#1=IFCPROJECT(\'0000000000000000000001\',$,\'Test\',$,$,$,$,(#20),#10);',
    '#10=IFCUNITASSIGNMENT((#11));',
    `#11=IFCSIUNIT(*,.LENGTHUNIT.,${opts.unit ? `.${opts.unit}.` : '$'},.METRE.);`,
    '#20=IFCGEOMETRICREPRESENTATIONCONTEXT($,\'Model\',3,1.E-05,#21,$);',
    '#21=IFCAXIS2PLACEMENT3D(#22,$,$);',
    '#22=IFCCARTESIANPOINT((0.,0.,0.));',
    '#30=IFCDIRECTION((0.,0.,1.));',
  ];
  boxes.forEach((b, i) => {
    const id = 100 + i * 20;
    const guid = String(id).padStart(22, '0');
    const k = opts.unit === 'MILLI' ? 1000 : 1;
    const [x, y, z] = b.at.map((v) => v * k);
    const [dx, dy, dz] = b.size.map((v) => v * k);
    const common = `'${guid}',$,'${b.type} ${i}',$,$,#${id + 1},#${id + 2},$`;
    const pre = `.${b.predefined ?? 'NOTDEFINED'}.`;
    let entity: string;
    if (b.type === 'IFCWINDOW' || b.type === 'IFCDOOR') entity = `${b.type}(${common},${n(dz)},${n(dx)},$,$,$)`;
    else if (b.type === 'IFCSPACE') entity = `IFCSPACE('${guid}',$,'space',$,$,#${id + 1},#${id + 2},$,.ELEMENT.,.INTERNAL.,$)`;
    else entity = `${b.type}(${common},${pre})`;
    lines.push(
      `#${id}=${entity};`,
      `#${id + 1}=IFCLOCALPLACEMENT($,#${id + 3});`,
      `#${id + 2}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${id + 5}));`,
      `#${id + 3}=IFCAXIS2PLACEMENT3D(#${id + 4},$,$);`,
      `#${id + 4}=IFCCARTESIANPOINT((${n(x)},${n(y)},${n(z)}));`,
      `#${id + 5}=IFCSHAPEREPRESENTATION(#20,'Body','SweptSolid',(#${id + 6}));`,
      `#${id + 6}=IFCEXTRUDEDAREASOLID(#${id + 7},#${id + 9},#30,${n(dz)});`,
      `#${id + 7}=IFCRECTANGLEPROFILEDEF(.AREA.,$,#${id + 8},${n(dx)},${n(dy)});`,
      `#${id + 8}=IFCAXIS2PLACEMENT2D(#${id + 10},$);`,
      `#${id + 9}=IFCAXIS2PLACEMENT3D(#22,$,$);`,
      `#${id + 10}=IFCCARTESIANPOINT((${n(dx / 2)},${n(dy / 2)}));`,
    );
  });
  const elevations = [...new Set(boxes.map((b) => b.storey).filter((z): z is number => z !== undefined))];
  elevations.forEach((z, i) => {
    const id = 5000 + i * 10;
    const scaled = opts.unit === 'MILLI' ? z * 1000 : z;
    const members = boxes.map((b, j) => (b.storey === z ? `#${100 + j * 20}` : null)).filter((m) => m !== null);
    lines.push(
      `#${id}=IFCBUILDINGSTOREY('${String(id).padStart(22, '0')}',$,'Plan ${i + 1}',$,$,$,$,$,.ELEMENT.,${n(scaled)});`,
      `#${id + 1}=IFCRELCONTAINEDINSPATIALSTRUCTURE('${String(id + 1).padStart(22, '0')}',$,$,$,(${members.join(',')}),#${id});`,
    );
  });
  return [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');",
    "FILE_NAME('test.ifc','2026-10-13T00:00:00',(''),(''),'','','');",
    "FILE_SCHEMA(('IFC4'));",
    'ENDSEC;',
    'DATA;',
    ...lines,
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n');
}
