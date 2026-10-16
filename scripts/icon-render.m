// icon-render <bundle> <out-prefix> <px> [appearance variant [#tint]]...: renders an app bundle's icon offscreen the way
// macOS 26 draws it, through IconServices, in an explicit appearance: 0 light or 1 dark, and variant 0 default, 2 clear,
// or 2 with a #rrggbb tint for tinted. It writes <out-prefix>-a<appearance>-v<variant>[-<tint>]-<px>.png. IconServices'
// image descriptor is private API; this is a tool for scripts/make-icon.sh and research/logo, never part of the app.
#import <AppKit/AppKit.h>
#include <dlfcn.h>
@interface IFColor : NSObject
- (instancetype)initWithRed:(double)r green:(double)g blue:(double)b alpha:(double)a;
@end
@interface ISImageDescriptor : NSObject
- (instancetype)initWithSize:(CGSize)size scale:(double)scale;
@property long long appearance; @property long long appearanceVariant; @property (strong) IFColor *tintColor;
@end
@interface ISIcon : NSObject
- (instancetype)initWithURL:(NSURL *)url;
- (instancetype)initWithBundleURL:(NSURL *)url;
- (CGImageRef)CGImageForDescriptor:(ISImageDescriptor *)d;
- (void)prepareImagesForImageDescriptors:(NSArray *)a;
@end
int main(int argc, const char **argv) {
  @autoreleasepool {
    dlopen("/System/Library/PrivateFrameworks/IconServices.framework/IconServices", RTLD_NOW);
    NSURL *url = [NSURL fileURLWithPath:@(argv[1])];
    NSString *prefix = @(argv[2]);
    double px = atof(argv[3]);
    ISIcon *icon = [[NSClassFromString(@"ISIcon") alloc] initWithURL:url];
    for (int i = 4; i + 1 < argc; ) {
      long long ap = atoll(argv[i]), va = atoll(argv[i + 1]); i += 2;
      ISImageDescriptor *d = [[NSClassFromString(@"ISImageDescriptor") alloc] initWithSize:CGSizeMake(px, px) scale:1];
      d.appearance = ap; d.appearanceVariant = va;
      NSString *tag = [NSString stringWithFormat:@"a%lld-v%lld", ap, va];
      if (i < argc && argv[i][0] == '#') {
        unsigned hex = (unsigned)strtoul(argv[i] + 1, NULL, 16); i += 1;
        d.tintColor = [[NSClassFromString(@"IFColor") alloc] initWithRed:((hex >> 16) & 255) / 255.0 green:((hex >> 8) & 255) / 255.0 blue:(hex & 255) / 255.0 alpha:1];
        tag = [tag stringByAppendingFormat:@"-%06x", hex];
      }
      [icon prepareImagesForImageDescriptors:@[d]];
      CGImageRef img = [icon CGImageForDescriptor:d];
      if (!img) { fprintf(stderr, "no image for %s\n", tag.UTF8String); continue; }
      NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithCGImage:img];
      NSString *path = [NSString stringWithFormat:@"%@-%@-%d.png", prefix, tag, (int)px];
      [[rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:path atomically:YES];
      printf("%s %zux%zu\n", path.UTF8String, CGImageGetWidth(img), CGImageGetHeight(img));
    }
  }
}
