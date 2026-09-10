Shader "Cane/Final Packet"
{
    Properties
    {
        _CaneTexture ("Raw texture", 2D) = "white" {}
        [HideInInspector] _CaneSrcRgb ("Source RGB", Float) = 1
        [HideInInspector] _CaneDstRgb ("Destination RGB", Float) = 10
        [HideInInspector] _CaneDstAlpha ("Destination alpha", Float) = 10
    }
    SubShader
    {
        Tags { "Queue"="Transparent" "RenderType"="Transparent" }
        Pass
        {
            Cull Off ZWrite Off ZTest LEqual
            Blend [_CaneSrcRgb] [_CaneDstRgb], One [_CaneDstAlpha]
            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"
            Texture2D<float4> _CaneTexture;
            float4 _CaneSize, _CaneSampling, _CaneTextureFlags, _CaneLight, _CaneDark;
            struct Input { float4 vertex : POSITION; float2 uv : TEXCOORD0; };
            struct Varying { float4 vertex : SV_POSITION; float2 uv : TEXCOORD0; };
            Varying vert(Input input)
            {
                Varying output; output.vertex = UnityObjectToClipPos(input.vertex); output.uv = input.uv; return output;
            }
            int address(int coordinate, int extent, int mode)
            {
                if (mode == 0) return clamp(coordinate, 0, extent - 1);
                uint period = (uint)extent * (mode == 1 ? 1u : 2u);
                // Unsigned magnitude also handles INT_MIN, without signed negation overflow.
                uint magnitude = coordinate < 0 ? 0u - (uint)coordinate : (uint)coordinate;
                uint wrapped = magnitude % period;
                if (coordinate < 0 && wrapped != 0u) wrapped = period - wrapped;
                return (int)(mode == 2 && wrapped >= (uint)extent ? period - 1u - wrapped : wrapped);
            }
            float3 decode_srgb(float3 color)
            {
                return float3(color.r <= .04045 ? color.r / 12.92 : pow((color.r + .055) / 1.055, 2.4),
                    color.g <= .04045 ? color.g / 12.92 : pow((color.g + .055) / 1.055, 2.4),
                    color.b <= .04045 ? color.b / 12.92 : pow((color.b + .055) / 1.055, 2.4));
            }
            float4 texel(int2 pixel)
            {
                pixel.x = address(pixel.x, (int)_CaneSize.x, (int)_CaneSampling.z);
                pixel.y = address(pixel.y, (int)_CaneSize.y, (int)_CaneSampling.w);
                // Core UVs use a top-left origin; Unity decoded Texture2D pixels use bottom-left.
                pixel.y = (int)_CaneSize.y - 1 - pixel.y;
                float4 value = _CaneTexture.Load(int3(pixel, 0));
                if (_CaneTextureFlags.x > .5) value.rgb = decode_srgb(value.rgb);
                return value;
            }
            float4 sample_texture(float2 uv)
            {
                float2 pixel = uv * _CaneSize.xy;
                float footprint = max(length(ddx(pixel)), length(ddy(pixel)));
                float interpolate = footprint > 1.0 ? _CaneSampling.x : _CaneSampling.y;
                float4 sampled = float4(0, 0, 0, 0);
                if (interpolate < .5) sampled = texel((int2)floor(pixel));
                else
                {
                    float2 position = pixel - .5, part = frac(position);
                    int2 base = (int2)floor(position);
                    sampled = lerp(lerp(texel(base), texel(base + int2(1, 0)), part.x),
                        lerp(texel(base + int2(0, 1)), texel(base + int2(1, 1)), part.x), part.y);
                }
                return sampled;
            }
            float4 frag(Varying input) : SV_Target
            {
                float4 value = sample_texture(input.uv);
                if (_CaneTextureFlags.y > .5) value.rgb = value.a > .000001 ? value.rgb / value.a : float3(0, 0, 0);
                float3 rgb = _CaneDark.w > .5 ? _CaneDark.rgb + (_CaneLight.rgb - _CaneDark.rgb) * value.rgb : _CaneLight.rgb * value.rgb;
                float alpha = value.a * _CaneLight.a;
                return float4(rgb * alpha, alpha);
            }
            ENDHLSL
        }
    }
    Fallback Off
}
