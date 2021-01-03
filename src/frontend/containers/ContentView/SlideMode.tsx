import React, { useCallback, useEffect, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import PinchZoomPan from 'react-responsive-pinch-zoom-pan';

import UiStore from '../../stores/UiStore';
import FileStore from '../../stores/FileStore';

import { IconSet } from 'widgets';

import { MissingImageFallback } from './GalleryItem';
import Inspector from '../Inspector';

interface SlideModeProps {
  contentRect: { width: number; height: number };
  uiStore: UiStore;
  fileStore: FileStore;
}

const SlideMode = (props: SlideModeProps) => {
  const { contentRect, uiStore, fileStore } = props;
  const { fileList } = fileStore;
  // Go to the first selected image on load
  useEffect(() => {
    if (uiStore.firstSelectedFile !== undefined) {
      uiStore.setFirstItem(fileStore.getIndex(uiStore.firstSelectedFile.id));
    }
  }, [fileStore, uiStore]);

  // Go back to previous view when pressing the back button (mouse button 5)
  useEffect(() => {
    // Push a dummy state, so that a pop-state event can be activated
    history.pushState(null, document.title, location.href);
    const popStateHandler = uiStore.disableSlideMode;
    window.addEventListener('popstate', popStateHandler);
    return () => window.removeEventListener('popstate', popStateHandler);
  }, [uiStore.disableSlideMode]);

  // Automatically select the active image, so it is shown in the inspector
  useEffect(() => {
    if (uiStore.firstItem < fileList.length) {
      uiStore.selectFile(fileList[uiStore.firstItem], true);
    }
  }, [fileList, uiStore]);

  const decrImgIndex = useCallback(() => uiStore.setFirstItem(Math.max(0, uiStore.firstItem - 1)), [
    uiStore,
  ]);
  const incrImgIndex = useCallback(
    () => uiStore.setFirstItem(Math.min(uiStore.firstItem + 1, fileList.length - 1)),
    [uiStore, fileList.length],
  );

  // Detect left/right arrow keys to scroll between images
  const handleUserKeyPress = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        decrImgIndex();
      } else if (event.key === 'ArrowRight') {
        incrImgIndex();
      } else if (event.key === 'Escape' || event.key === 'Backspace') {
        uiStore.disableSlideMode();
      }
    },
    [incrImgIndex, decrImgIndex, uiStore],
  );

  // Detect scroll wheel to scroll between images
  const handleUserWheel = useCallback(
    (event: WheelEvent) => {
      if (event.ctrlKey) {
        return;
      }
      event.preventDefault();

      if (event.deltaY > 0) {
        decrImgIndex();
      } else if (event.deltaY < 0) {
        incrImgIndex();
      }
    },
    [incrImgIndex, decrImgIndex],
  );

  // Set up event listeners
  useEffect(() => {
    window.addEventListener('keydown', handleUserKeyPress);
    // window.addEventListener('wheel', handleUserWheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', handleUserKeyPress);
      // window.removeEventListener('wheel', handleUserWheel);
    };
  }, [handleUserKeyPress, handleUserWheel]);

  // Preload next and previous image for better UX
  useEffect(() => {
    if (uiStore.firstItem + 1 < fileList.length) {
      const nextImg = new Image();
      nextImg.src = fileList[uiStore.firstItem + 1].absolutePath;
    }
    if (uiStore.firstItem - 1 >= 0) {
      const prevImg = new Image();
      prevImg.src = fileList[uiStore.firstItem - 1].absolutePath;
    }
  }, [fileList, uiStore.firstItem]);

  const inspectorWidth = 288;
  // useMemo(() =>
  //   parseInt(getComputedStyle(document.body).getPropertyValue('--inspector-width')) // rem value: get pixels by multplying with font size
  //   * parseInt(getComputedStyle(document.body).getPropertyValue('font-size')),
  //   []);
  const contentWidth = contentRect.width - (uiStore.isInspectorOpen ? inspectorWidth : 0);

  if (uiStore.firstItem >= fileList.length) {
    return <p>No files available</p>;
  }

  const file = fileList[uiStore.firstItem];

  // TODO: If image is broken, cannot go back/forward
  return (
    <div id="slide-mode">
      {file.isBroken ? (
        <MissingImageFallback
          style={{
            width: `${contentWidth}px`,
            height: `${contentRect.height}px`,
          }}
        />
      ) : (
          <ZoomableImage
            src={file.absolutePath}
            width={contentWidth}
            height={contentRect.height}
            prevImage={uiStore.firstItem - 1 >= 0 ? decrImgIndex : undefined}
            nextImage={uiStore.firstItem + 1 < fileList.length ? incrImgIndex : undefined}
          />
        )}
      <Inspector />
    </div>
  );
};

interface IZoomableImageProps {
  src: string;
  width: number;
  height: number;
  prevImage?: () => any;
  nextImage?: () => any;
}

const ZoomableImage = ({ src, width, height, prevImage, nextImage }: IZoomableImageProps) => {
  // Todo: Same context menu as GalleryItem
  return (
    <div id="zoomableImage">
      <div
        style={{
          width: `${width}px`,
          maxHeight: `${height}px`,
        }}
      >
        {/* https://github.com/bradstiff/react-responsive-pinch-zoom-pan */}
        <PinchZoomPan position="center" zoomButtons={false} doubleTapBehavior="zoom">
          <img src={src} alt={src} />
        </PinchZoomPan>

        {/* Overlay buttons/icons */}
        {prevImage && (
          <div className="side-button custom-icon-48" onClick={prevImage}>
            {IconSet.ARROW_LEFT}
          </div>
        )}
        {nextImage && (
          <div className="side-button custom-icon-48" onClick={nextImage} style={{ right: 0 }}>
            {IconSet.ARROW_RIGHT}
          </div>
        )}
      </div>
    </div>
  );
};

export default observer(SlideMode);
