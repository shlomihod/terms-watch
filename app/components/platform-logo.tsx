'use client';

import { Globe } from 'lucide-react';
import * as icons from 'simple-icons';

// Custom icons for services not available in simple-icons
const customIcons: Record<string, { svg: string; hex: string }> = {
  'linkedin': {
    svg: '<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>LinkedIn</title><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>',
    hex: '0077B5'
  },
  'microsoft': {
    svg: '<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>Microsoft</title><path d="M0 0v11.408h11.408V0zm12.594 0v11.408H24V0zM0 12.594V24h11.408V12.594zm12.594 0V24H24V12.594z"/></svg>',
    hex: '5E5E5E'
  },
  'deepseek': {
    // DeepSeek whale icon (official logo, scaled to 24x24)
    svg: '<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>DeepSeek</title><path d="M23.703 2.013c-.256-.168-.363.151-.512.319-.051.052-.094.122-.137.186-.371.539-.806.893-1.37.851-.828-.063-1.537.29-2.16 1.152-.132-1.06-.576-1.692-1.247-2.103-.35-.209-.709-.423-.953-.881-.171-.325-.218-.69-.303-1.049-.056-.215-.111-.44-.295-.475-.201-.041-.278.185-.355.376-.312.777-.436 1.633-.423 2.498.026 1.947.633 3.5 1.837 4.602.137.127.171.255.128.44-.081.382-.179.748-.265 1.131-.056.243-.137.296-.329.191-.662-.376-1.235-.928-1.738-1.599-.858-1.124-1.631-2.363-2.597-3.337-.226-.226-.453-.44-.688-.637-.987-1.298.128-2.363.389-2.492.269-.133.094-.585-.777-.58-.871 0-1.67.4-2.687.927-.15.081-.303.139-.466.185-.922-.238-1.883-.29-2.883-.139-1.883.284-3.391 1.495-4.498 3.558-1.671 3.114-2.025 5.527-1.589 8.524.401 3.1 1.568 5.666 3.361 7.672 1.858 2.08 3.998 3.1 6.441 2.905 1.482-.116 3.135-.388 5-.522.47.319.961.446 1.782.539.628.081 1.235-.041 1.704-.174.734-.209.684-1.136.419-1.303-2.156-1.361-1.683-.806-2.115-1.257 1.094-1.756 2.747-3.587 3.392-9.503.051-.469.009-.765 0-1.147 0-.232.034-.325.231-.347.538-.087 1.064-.284 1.546-.643 1.397-1.037 1.961-2.735 2.092-4.773.021-.313 0-.632-.248-.8zm-12.18 18.353c-2.088-2.225-3.102-2.961-3.52-2.929-.393.029-.321.637-.235 1.036.089.388.209.661.371 1 .115.226.192.562-.115.817-.675.562-1.842-.191-1.897-.226-1.363-1.089-2.498-2.526-3.302-4.482-.773-1.889-1.226-3.919-1.299-6.084-.021-.522.094-.707.478-.8.504-.127 1.025-.151 1.529-.052 2.133.423 3.947 1.715 5.468 3.766.868 1.164 1.524 2.561 2.204 3.925.722 1.448 1.495 2.822 2.482 3.953.35.394.628.695.893.922-.803.122-2.139.151-3.055-.835zm1-8.743c0-.232.137-.417.307-.417.038 0 .073.011.107.029.043.023.081.052.115.099.056.075.086.18.086.29 0 .232-.137.417-.307.417s-.303-.185-.303-.417zm3.109 2.168c-.201.11-.397.209-.589.215-.299.023-.623-.145-.799-.342-.273-.313-.47-.487-.551-1.031-.034-.232-.017-.591.017-.8.068-.446-.009-.73-.239-.985-.188-.209-.427-.267-.688-.267-.098 0-.188-.058-.256-.104-.111-.075-.201-.261-.115-.487.026-.075.162-.255.192-.284.355-.272.769-.185 1.145.023.35.197.62.556 1 1.06.393.614.461.782.684 1.242.175.359.337.73.444 1.154.068.267-.021.481-.252.614z"/></svg>',
    hex: '4D6BFE'
  }
};

interface PlatformLogoProps {
  service: string;
  size?: number;
}

export function PlatformLogo({ service, size = 16 }: PlatformLogoProps) {
  const serviceLower = service.toLowerCase();
  
  // Map service names to Simple Icons keys
  const iconMap: Record<string, string> = {
    // Social Media Platforms
    'facebook': 'siFacebook',
    'instagram': 'siInstagram',
    'x': 'siX',
    'twitter': 'siX',
    'youtube': 'siYoutube',
    'whatsapp': 'siWhatsapp',
    'tiktok': 'siTiktok',
    'snapchat': 'siSnapchat',
    'pinterest': 'siPinterest',
    'reddit': 'siReddit',
    'tumblr': 'siTumblr',
    'twitch': 'siTwitch',
    'telegram': 'siTelegram',
    'wechat': 'siWechat',
    'line': 'siLine',
    'spotify': 'siSpotify',
    'threads': 'siThreads',
    'bluesky': 'siBluesky',
    'bereal': 'siBereal',
    'quora': 'siQuora',
    'parler': 'siParler',
    'truth social': 'siTruthsocial',
    'truthsocial': 'siTruthsocial',
    
    // AI Services
    'chatgpt': 'siOpenai',
    'openai': 'siOpenai',
    'claude': 'siAnthropic',
    'claude.ai': 'siAnthropic',
    'github copilot': 'siGithubcopilot',
    'microsoft copilot': 'microsoft',
    'copilot': 'microsoft',
    'google bard': 'siGoogle',
    'bard': 'siGoogle',
    'google generative ai services': 'siGoogle',
    'midjourney': 'siMidjourney',
    'dall-e': 'siOpenai',
    'dall·e': 'siOpenai',
    'perplexity': 'siPerplexity',
    'grok': 'siX', // xAI's Grok
    'xai': 'siX',
    'cursor': 'siVisualstudiocode', // Similar editor
    'replit': 'siReplit',
    'doubao': 'siBytedance',
    'fireworks ai': 'siFirebase', // Similar
    'le chat': 'siMistralai',
    'mistral ai': 'siMistralai',
    'meta ai': 'siMeta',
    'llama api': 'siMeta',
    'deepseek': 'deepseek',
    'qwen chat': 'siAlibaba',
    'replicate': 'siReplicate',
    'wenxinyiyan': 'siBaidu',
  };
  
  // Try to find the icon
  let iconKey = iconMap[serviceLower];
  
  if (!iconKey) {
    // Check for partial matches
    for (const [key, value] of Object.entries(iconMap)) {
      if (serviceLower.includes(key) || key.includes(serviceLower)) {
        iconKey = value;
        break;
      }
    }
  }
  
  // Get the icon from simple-icons or custom icons
  let iconSvg = null;
  let iconColor = '#6B7280'; // Default gray color
  
  if (iconKey) {
    // First check if it's a custom icon
    if (customIcons[iconKey]) {
      const customIcon = customIcons[iconKey];
      iconSvg = customIcon.svg;
      iconColor = `#${customIcon.hex}`;
    }
    // Then check simple-icons
    else if (icons[iconKey as keyof typeof icons]) {
      const icon = icons[iconKey as keyof typeof icons] as { svg: string; hex: string };
      iconSvg = icon.svg;
      iconColor = `#${icon.hex}`;
    }
  }
  
  // If still not found, check custom icons directly by service name
  if (!iconSvg && customIcons[serviceLower]) {
    const customIcon = customIcons[serviceLower];
    iconSvg = customIcon.svg;
    iconColor = `#${customIcon.hex}`;
  }
  
  // If we have an SVG, render it
  if (iconSvg) {
    return (
      <span 
        className="inline-flex items-center justify-center"
        style={{ width: size, height: size }}
        dangerouslySetInnerHTML={{ 
          __html: iconSvg.replace(
            '<svg',
            `<svg width="${size}" height="${size}" fill="${iconColor}"`
          )
        }}
      />
    );
  }
  
  // Default fallback icon
  return (
    <span className="text-gray-700">
      <Globe size={size} />
    </span>
  );
}