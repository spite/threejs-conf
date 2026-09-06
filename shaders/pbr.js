const MAX_DIR_LIGHTS = 4;
const MAX_POINT_LIGHTS = 4;
const MAX_HEMI_LIGHTS = 2;

const shader = `
precision highp float;

#define PI 3.141592653589793
#define RECIPROCAL_PI 0.3183098861837907
#define EPSILON 1e-6
#define saturate( a ) clamp( a, 0.0, 1.0 )

struct DirectionalLight { vec3 direction; vec3 color; };
struct HemisphereLight { vec3 direction; vec3 skyColor; vec3 groundColor; };
struct PointLightSource { vec3 position; vec3 color; float distance; float decay; };

uniform mat4 viewMatrix;
uniform bool hasEnvMap;

uniform vec3 color; 


uniform bool hasRoughnessMap;
uniform float roughness;
uniform float roughnessScale;
uniform float specularAA;
uniform sampler2D roughnessMap;

uniform float metalness;

uniform bool hasNormalMap;
uniform sampler2D normalMap;
uniform vec2 normalScale;

uniform float toneMappingExposure; // Added exposure uniform

#define MAX_DIR_LIGHTS ${MAX_DIR_LIGHTS}
#define MAX_HEMI_LIGHTS ${MAX_HEMI_LIGHTS}
#define MAX_POINT_LIGHTS ${MAX_POINT_LIGHTS}
uniform DirectionalLight directionalLights[MAX_DIR_LIGHTS];
uniform HemisphereLight hemisphereLights[MAX_HEMI_LIGHTS];
uniform PointLightSource pointLights[MAX_POINT_LIGHTS];
uniform int numDirectionalLights;
uniform int numHemisphereLights;
uniform int numPointLights;

uniform vec3 ambientLightColor;
uniform vec3 cameraPosition; 

uniform sampler2D envMap; 
uniform float envMapIntensity;
// PMREM constants - calculated from texture dimensions
uniform float cubeUV_maxMip;
uniform float cubeUV_texelWidth;
uniform float cubeUV_texelHeight;

uniform mat3 normalMatrix;

in vec3 vPosition;
in vec3 vViewPosition;
in vec3 vWorldPosition;
in vec3 vNormal;
in vec3 vObjectNormal;
in vec2 vUv;
in vec4 vClipCurrent;
in vec4 vClipPrevious;
in float vThickness;

uniform vec3 sssColor;
uniform float sssStrength;
uniform float sssPower;
uniform float sssDistortion;
uniform float sssDensity;

layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 fragPosition;
layout(location = 2) out vec4 fragNormal;
layout(location = 3) out vec4 fragVelocity;
layout(location = 4) out vec4 fragPointLight;

// --- Three.js Standard ACES Implementation ---
vec3 RRTAndODTFit( vec3 v ) {
    vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
    vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
    return a / b;
}

vec3 ACESFilmicToneMapping( vec3 color ) {
    const mat3 ACESInputMat = mat3(
        0.59719, 0.07600, 0.02840,
        0.35458, 0.90834, 0.13383,
        0.04823, 0.01566, 0.83777
    );
    const mat3 ACESOutputMat = mat3(
        1.60475, -0.10208, -0.00327,
        -0.53108,  1.10813, -0.07276,
        -0.07367, -0.00605,  1.07602
    );

    // Three.js exposure correction factor
    color *= toneMappingExposure / 0.6;

    color = ACESInputMat * color;
    color = RRTAndODTFit( color );
    color = ACESOutputMat * color;

    return saturate( color );
}

vec4 linearToSRGB( in vec4 value ) {
    return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}

float getDistanceAttenuation(float lightDistance, float cutoffDistance, float decayExponent) {
    float distanceFalloff = 1.0 / max(pow(lightDistance, decayExponent), 0.01);
    if (cutoffDistance > 0.0) {
        float t = clamp(1.0 - pow(lightDistance / cutoffDistance, 4.0), 0.0, 1.0);
        distanceFalloff *= t * t;
    }
    return distanceFalloff;
}

vec3 F_Schlick(float u, vec3 f0) { return f0 + (vec3(1.0) - f0) * pow(1.0 - u, 5.0); }

vec3 F_SchlickRoughness(float u, vec3 f0, float roughness) {
    return f0 + (max(vec3(1.0 - roughness), f0) - f0) * pow(1.0 - u, 5.0);
}

float D_GGX(float NdotH, float alpha) {
    float a2 = alpha * alpha;
    float f = (NdotH * NdotH) * (a2 - 1.0) + 1.0;
    return a2 / (PI * f * f);
}

float V_GGX_SmithCorrelated(float alpha, float dotNV, float dotNL) {
    float a2 = alpha * alpha;
    float gv = dotNL * sqrt(dotNV * dotNV * (1.0 - a2) + a2);
    float gl = dotNV * sqrt(dotNL * dotNL * (1.0 - a2) + a2);
    return 0.5 / max(gv + gl, EPSILON);
}

vec2 EnvBRDFApprox(float roughness, float NoV) {
    vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
    vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
    vec4 r = roughness * c0 + c1;
    float a004 = min(r.x * r.x, exp2(-9.28 * NoV)) * r.x + r.y;
    vec2 AB = vec2(-1.04, 1.04) * a004 + r.zw;
    return AB;
}

// ============== Three.js PMREM Sampling (exact copy from cube_uv_reflection_fragment.glsl.js) ==============
#define cubeUV_minMipLevel 4.0
#define cubeUV_minTileSize 16.0

float getFace( vec3 direction ) {
    vec3 absDirection = abs( direction );
    float face = - 1.0;
    if ( absDirection.x > absDirection.z ) {
        if ( absDirection.x > absDirection.y )
            face = direction.x > 0.0 ? 0.0 : 3.0;
        else
            face = direction.y > 0.0 ? 1.0 : 4.0;
    } else {
        if ( absDirection.z > absDirection.y )
            face = direction.z > 0.0 ? 2.0 : 5.0;
        else
            face = direction.y > 0.0 ? 1.0 : 4.0;
    }
    return face;
}

vec2 getUV( vec3 direction, float face ) {
    vec2 uv;
    if ( face == 0.0 ) {
        uv = vec2( direction.z, direction.y ) / abs( direction.x );
    } else if ( face == 1.0 ) {
        uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
    } else if ( face == 2.0 ) {
        uv = vec2( - direction.x, direction.y ) / abs( direction.z );
    } else if ( face == 3.0 ) {
        uv = vec2( - direction.z, direction.y ) / abs( direction.x );
    } else if ( face == 4.0 ) {
        uv = vec2( - direction.x, direction.z ) / abs( direction.y );
    } else {
        uv = vec2( direction.x, direction.y ) / abs( direction.z );
    }
    return 0.5 * ( uv + 1.0 );
}

vec3 bilinearCubeUV( sampler2D envMapSampler, vec3 direction, float mipInt ) {
    float face = getFace( direction );
    float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
    mipInt = max( mipInt, cubeUV_minMipLevel );
    float faceSize = exp2( mipInt );
    
    highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
    
    if ( face > 2.0 ) {
        uv.y += faceSize;
        face -= 3.0;
    }
    
    uv.x += face * faceSize;
    uv.x += filterInt * 3.0 * cubeUV_minTileSize;
    uv.y += 4.0 * ( exp2( cubeUV_maxMip ) - faceSize );
    
    uv.x *= cubeUV_texelWidth;
    uv.y *= cubeUV_texelHeight;

    return texture( envMapSampler, uv ).rgb;
}

#define cubeUV_r0 1.0
#define cubeUV_m0 - 2.0
#define cubeUV_r1 0.8
#define cubeUV_m1 - 1.0
#define cubeUV_r4 0.4
#define cubeUV_m4 2.0
#define cubeUV_r5 0.305
#define cubeUV_m5 3.0
#define cubeUV_r6 0.21
#define cubeUV_m6 4.0

float roughnessToMip( float roughness ) {
    float mip = 0.0;
    if ( roughness >= cubeUV_r1 ) {
        mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
    } else if ( roughness >= cubeUV_r4 ) {
        mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
    } else if ( roughness >= cubeUV_r5 ) {
        mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
    } else if ( roughness >= cubeUV_r6 ) {
        mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
    } else {
        mip = - 2.0 * log2( 1.16 * roughness );
    }
    return mip;
}

vec4 textureCubeUV( sampler2D envMapSampler, vec3 sampleDir, float roughness ) {
    float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, cubeUV_maxMip );
    float mipF = fract( mip );
    float mipInt = floor( mip );
    
    vec3 color0 = bilinearCubeUV( envMapSampler, sampleDir, mipInt );
    if ( mipF == 0.0 ) {
        return vec4( color0, 1.0 );
    } else {
        vec3 color1 = bilinearCubeUV( envMapSampler, sampleDir, mipInt + 1.0 );
        return vec4( mix( color0, color1, mipF ), 1.0 );
    }
}
// ============== End PMREM Sampling ==============

void calculateLight(vec3 L, vec3 lightColor, vec3 geometryNormal, vec3 viewDir, vec3 f0, float alpha, float metalnessFactor, vec3 diffuseReflectance, inout vec3 reflectedLight, inout vec3 diffuseLight) {
    vec3 H = normalize(L + viewDir);
    float NdotL = clamp(dot(geometryNormal, L), 0.0, 1.0);
    float NdotV = clamp(abs(dot(geometryNormal, viewDir)), 0.0, 1.0);
    float NdotH = clamp(dot(geometryNormal, H), 0.0, 1.0);
    float VdotH = clamp(dot(viewDir, H), 0.0, 1.0);
    if (NdotL > 0.0) {
        vec3 F = F_Schlick(VdotH, f0);
        float D = D_GGX(NdotH, alpha);
        float V = V_GGX_SmithCorrelated(alpha, NdotV, NdotL);
        vec3 specular = F * (D * V);
        vec3 kD = (vec3(1.0) - F) * (1.0 - metalnessFactor);
        vec3 diffuse = diffuseReflectance * RECIPROCAL_PI;
        reflectedLight += specular * lightColor * NdotL;
        diffuseLight += diffuse * lightColor * NdotL;
    }
}

vec3 shade(in vec3 worldPosition, in vec3 worldNormal, in vec2 uv, in vec4 diffuseColor, in float roughness, in float metalness, out vec3 pointContribution) {
   
    float metalnessFactor = metalness;
    float roughnessFactor = max(roughness, 0.0525);
    float alpha = roughnessFactor * roughnessFactor;

    vec3 f0 = vec3(0.04);
    f0 = mix(f0, diffuseColor.rgb, metalnessFactor);
    vec3 diffuseReflectance = diffuseColor.rgb * (1.0 - metalnessFactor);

    vec3 geometryNormal = worldNormal; 
    vec3 viewDir = normalize(cameraPosition - worldPosition);

    vec3 reflectedLight = vec3(0.0);
    vec3 diffuseLight = vec3(0.0);

    vec3 subsurface = vec3(0.0);
    float transmit = exp(-max(vThickness, 0.0) * sssDensity);

    for(int i = 0; i < MAX_DIR_LIGHTS; i++) {
        if (i >= numDirectionalLights) break;
        vec3 L = normalize(directionalLights[i].direction);
        calculateLight(L, directionalLights[i].color, geometryNormal, viewDir, f0, alpha, metalnessFactor, diffuseReflectance, reflectedLight, diffuseLight);

        if (sssStrength > 0.0) {
            vec3 back = normalize(-L - geometryNormal * sssDistortion);
            float wrap = clamp(dot(geometryNormal, L) * 0.5 + 0.5, 0.0, 1.0);
            float through = pow(clamp(dot(viewDir, back), 0.0, 1.0), sssPower);
            subsurface += directionalLights[i].color * (through + wrap * 0.25) * transmit;
        }
    }

    pointContribution = vec3(0.0);
    for(int i = 0; i < MAX_POINT_LIGHTS; i++) {
        if (i >= numPointLights) break;
        vec3 toLight = pointLights[i].position - worldPosition;
        float lightDistance = length(toLight);
        vec3 L = toLight / max(lightDistance, EPSILON);
        vec3 lightColor = pointLights[i].color * getDistanceAttenuation(lightDistance, pointLights[i].distance, pointLights[i].decay);

        vec3 pReflected = vec3(0.0);
        vec3 pDiffuse = vec3(0.0);
        calculateLight(L, lightColor, geometryNormal, viewDir, f0, alpha, metalnessFactor, diffuseReflectance, pReflected, pDiffuse);
        reflectedLight += pReflected;
        diffuseLight += pDiffuse;
        pointContribution += pReflected + pDiffuse;

        if (sssStrength > 0.0) {
            vec3 back = normalize(-L - geometryNormal * sssDistortion);
            float wrap = clamp(dot(geometryNormal, L) * 0.5 + 0.5, 0.0, 1.0);
            float through = pow(clamp(dot(viewDir, back), 0.0, 1.0), sssPower);
            vec3 sss = lightColor * (through + wrap * 0.25) * transmit;
            subsurface += sss;
            pointContribution += sss * sssColor * sssStrength * diffuseColor.rgb;
        }
    }

    vec3 indirectSpecular = vec3(0.0);
    vec3 indirectDiffuse = vec3(0.0);

    // Hemisphere/ambient lights - simple Lambertian diffuse (no multi-scattering)
    vec3 ambientIrradiance = ambientLightColor;
    for(int i = 0; i < MAX_HEMI_LIGHTS; i++) {
        if (i >= numHemisphereLights) break;
        float weight = 0.5 * dot(geometryNormal, normalize(hemisphereLights[i].direction)) + 0.5;
        ambientIrradiance += mix(hemisphereLights[i].groundColor, hemisphereLights[i].skyColor, weight);
    }
    // Simple Lambert BRDF for ambient/hemisphere
    indirectDiffuse = ambientIrradiance * diffuseReflectance * RECIPROCAL_PI;
    
    if (hasEnvMap) {
        float NdotV = clamp(abs(dot(geometryNormal, viewDir)), 0.0, 1.0);
        
        // Reflection vector - bend toward normal for rough surfaces (Three.js getIBLRadiance)
        vec3 worldReflectVec = reflect(-viewDir, geometryNormal);
        worldReflectVec = normalize(mix(worldReflectVec, geometryNormal, roughnessFactor * roughnessFactor));
        
        // Sample prefiltered radiance
        vec3 radiance = textureCubeUV(envMap, worldReflectVec, roughnessFactor).rgb;
        radiance *= envMapIntensity;

        // Environment diffuse irradiance
        // Three.js getIBLIrradiance returns: PI * envMapColor * envMapIntensity
        // Then RE_IndirectSpecular divides by PI, so net effect is: envMapColor * envMapIntensity
        vec3 iblIrradiance = textureCubeUV(envMap, geometryNormal, 1.0).rgb;
        iblIrradiance *= envMapIntensity;
        // Note: NOT dividing by PI here since PMREM irradiance is already properly scaled
        
        // DFG approximation (split-sum approximation)
        vec2 fab = EnvBRDFApprox(roughnessFactor, NdotV);
        
        // Single scattering term
        float specularF90 = 1.0;
        vec3 FssEss = f0 * fab.x + specularF90 * fab.y;
        
        // Multi-scattering compensation (Fdez-Aguera's approach)
        float Ess = fab.x + fab.y;
        float Ems = 1.0 - Ess;
        vec3 Favg = f0 + (1.0 - f0) * 0.047619; // 1/21
        vec3 Fms = FssEss * Favg / (1.0 - Ems * Favg);
        
        // Total scattering
        vec3 singleScattering = FssEss;
        vec3 multiScattering = Fms * Ems;
        vec3 totalScattering = singleScattering + multiScattering;
        
        // IBL diffuse - reduced by total scattering for energy conservation
        vec3 iblDiffuse = diffuseReflectance * (1.0 - max(max(totalScattering.r, totalScattering.g), totalScattering.b));
        
        // IBL contribution with multi-scattering
        // Use iblIrradiance directly (Three.js: PI * sample / PI = sample)
        indirectSpecular = radiance * singleScattering + multiScattering * iblIrradiance;
        indirectDiffuse += iblDiffuse * iblIrradiance;
    }

    vec3 outgoingLight = reflectedLight + diffuseLight + indirectDiffuse + indirectSpecular;
    outgoingLight += subsurface * sssColor * sssStrength * diffuseColor.rgb;
    return outgoingLight;
}

`;

export { shader, MAX_DIR_LIGHTS, MAX_POINT_LIGHTS };
