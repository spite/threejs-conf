const shader = `
vec3 triplanarWeights(in vec3 n, float sharpness) {
  vec3 w = pow( abs( n ), vec3( sharpness ) );
  return w / max( w.x + w.y + w.z, 1e-6 );
}

vec4 triplanarTexture(in vec3 position, in vec3 n, in sampler2D map, float texScale, float sharpness) { 

  vec3 blend_weights = triplanarWeights( n, sharpness );

  vec2 coord1 = position.yz * texScale;
  vec2 coord2 = position.zx * texScale;
  vec2 coord3 = position.xy * texScale;

  vec4 col1 = texture( map, coord1 );  
  vec4 col2 = texture( map, coord2 );  
  vec4 col3 = texture( map, coord3 ); 

  vec4 blended_color = col1 * blend_weights.xxxx +  
                       col2 * blend_weights.yyyy +  
                       col3 * blend_weights.zzzz; 

  return blended_color;
}

vec3 triplanarNormal(in vec3 position, in vec3 n, in sampler2D map, float texScale, vec2 normalScale, float sharpness) {

  vec3 blend_weights = triplanarWeights( n, sharpness );

  vec4 sx = texture( map, position.yz * texScale );
  vec4 sy = texture( map, position.zx * texScale );
  vec4 sz = texture( map, position.xy * texScale );

  vec3 nx = vec3( sx.xy * 2. - 1., sx.z );
  vec3 ny = vec3( sy.xy * 2. - 1., sy.z );
  vec3 nz = vec3( sz.xy * 2. - 1., sz.z );

  nx.xy *= normalScale;
  ny.xy *= normalScale;
  nz.xy *= normalScale;

  nx = vec3( nx.xy + n.yz, abs( nx.z ) * n.x );
  ny = vec3( ny.xy + n.zx, abs( ny.z ) * n.y );
  nz = vec3( nz.xy + n.xy, abs( nz.z ) * n.z );

  return normalize(
    nx.zxy * blend_weights.x +
    ny.yzx * blend_weights.y +
    nz.xyz * blend_weights.z
  );
}
`;

export { shader };
