// Code generated by protoc-gen-gogo. DO NOT EDIT.
// source: agoric/swingset/genesis.proto

package types

import (
	fmt "fmt"
	_ "github.com/gogo/protobuf/gogoproto"
	proto "github.com/gogo/protobuf/proto"
	io "io"
	math "math"
	math_bits "math/bits"
)

// Reference imports to suppress errors if they are not otherwise used.
var _ = proto.Marshal
var _ = fmt.Errorf
var _ = math.Inf

// This is a compile-time assertion to ensure that this generated file
// is compatible with the proto package it is being compiled against.
// A compilation error at this line likely means your copy of the
// proto package needs to be updated.
const _ = proto.GoGoProtoPackageIsVersion3 // please upgrade the proto package

// The initial or exported state.
type GenesisState struct {
	Params               Params                       `protobuf:"bytes,2,opt,name=params,proto3" json:"params"`
	State                State                        `protobuf:"bytes,3,opt,name=state,proto3" json:"state"`
	SwingStoreExportData []*SwingStoreExportDataEntry `protobuf:"bytes,4,rep,name=swing_store_export_data,json=swingStoreExportData,proto3" json:"swingStoreExportData"`
}

func (m *GenesisState) Reset()         { *m = GenesisState{} }
func (m *GenesisState) String() string { return proto.CompactTextString(m) }
func (*GenesisState) ProtoMessage()    {}
func (*GenesisState) Descriptor() ([]byte, []int) {
	return fileDescriptor_49b057311de9d296, []int{0}
}
func (m *GenesisState) XXX_Unmarshal(b []byte) error {
	return m.Unmarshal(b)
}
func (m *GenesisState) XXX_Marshal(b []byte, deterministic bool) ([]byte, error) {
	if deterministic {
		return xxx_messageInfo_GenesisState.Marshal(b, m, deterministic)
	} else {
		b = b[:cap(b)]
		n, err := m.MarshalToSizedBuffer(b)
		if err != nil {
			return nil, err
		}
		return b[:n], nil
	}
}
func (m *GenesisState) XXX_Merge(src proto.Message) {
	xxx_messageInfo_GenesisState.Merge(m, src)
}
func (m *GenesisState) XXX_Size() int {
	return m.Size()
}
func (m *GenesisState) XXX_DiscardUnknown() {
	xxx_messageInfo_GenesisState.DiscardUnknown(m)
}

var xxx_messageInfo_GenesisState proto.InternalMessageInfo

func (m *GenesisState) GetParams() Params {
	if m != nil {
		return m.Params
	}
	return Params{}
}

func (m *GenesisState) GetState() State {
	if m != nil {
		return m.State
	}
	return State{}
}

func (m *GenesisState) GetSwingStoreExportData() []*SwingStoreExportDataEntry {
	if m != nil {
		return m.SwingStoreExportData
	}
	return nil
}

// A SwingStore "export data" entry.
type SwingStoreExportDataEntry struct {
	Key   string `protobuf:"bytes,1,opt,name=key,proto3" json:"key,omitempty"`
	Value string `protobuf:"bytes,2,opt,name=value,proto3" json:"value,omitempty"`
}

func (m *SwingStoreExportDataEntry) Reset()         { *m = SwingStoreExportDataEntry{} }
func (m *SwingStoreExportDataEntry) String() string { return proto.CompactTextString(m) }
func (*SwingStoreExportDataEntry) ProtoMessage()    {}
func (*SwingStoreExportDataEntry) Descriptor() ([]byte, []int) {
	return fileDescriptor_49b057311de9d296, []int{1}
}
func (m *SwingStoreExportDataEntry) XXX_Unmarshal(b []byte) error {
	return m.Unmarshal(b)
}
func (m *SwingStoreExportDataEntry) XXX_Marshal(b []byte, deterministic bool) ([]byte, error) {
	if deterministic {
		return xxx_messageInfo_SwingStoreExportDataEntry.Marshal(b, m, deterministic)
	} else {
		b = b[:cap(b)]
		n, err := m.MarshalToSizedBuffer(b)
		if err != nil {
			return nil, err
		}
		return b[:n], nil
	}
}
func (m *SwingStoreExportDataEntry) XXX_Merge(src proto.Message) {
	xxx_messageInfo_SwingStoreExportDataEntry.Merge(m, src)
}
func (m *SwingStoreExportDataEntry) XXX_Size() int {
	return m.Size()
}
func (m *SwingStoreExportDataEntry) XXX_DiscardUnknown() {
	xxx_messageInfo_SwingStoreExportDataEntry.DiscardUnknown(m)
}

var xxx_messageInfo_SwingStoreExportDataEntry proto.InternalMessageInfo

func (m *SwingStoreExportDataEntry) GetKey() string {
	if m != nil {
		return m.Key
	}
	return ""
}

func (m *SwingStoreExportDataEntry) GetValue() string {
	if m != nil {
		return m.Value
	}
	return ""
}

func init() {
	proto.RegisterType((*GenesisState)(nil), "agoric.swingset.GenesisState")
	proto.RegisterType((*SwingStoreExportDataEntry)(nil), "agoric.swingset.SwingStoreExportDataEntry")
}

func init() { proto.RegisterFile("agoric/swingset/genesis.proto", fileDescriptor_49b057311de9d296) }

var fileDescriptor_49b057311de9d296 = []byte{
	// 334 bytes of a gzipped FileDescriptorProto
	0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0xff, 0x74, 0x91, 0xcf, 0x4b, 0x02, 0x41,
	0x1c, 0xc5, 0x77, 0xf2, 0x07, 0x38, 0x06, 0xc5, 0x22, 0xb9, 0x09, 0x8d, 0xe2, 0x49, 0x82, 0x76,
	0xc0, 0xe8, 0x52, 0xa7, 0x2c, 0xe9, 0x1a, 0x2b, 0x5d, 0xba, 0xc8, 0xa8, 0xc3, 0xb4, 0xa8, 0x3b,
	0xcb, 0x7c, 0xc7, 0x52, 0xfa, 0x27, 0xfa, 0x13, 0xfa, 0x73, 0x3c, 0x7a, 0xec, 0x24, 0xa1, 0x97,
	0xe8, 0x6f, 0xe8, 0x10, 0x3b, 0xa3, 0x04, 0x6a, 0xb7, 0xb7, 0xfb, 0x79, 0xef, 0x0d, 0x33, 0x0f,
	0x9f, 0x30, 0x21, 0x55, 0xd8, 0xa5, 0xf0, 0x12, 0x46, 0x02, 0xb8, 0xa6, 0x82, 0x47, 0x1c, 0x42,
	0xf0, 0x63, 0x25, 0xb5, 0x74, 0x0f, 0x2c, 0xf6, 0xd7, 0xb8, 0x54, 0x10, 0x52, 0x48, 0xc3, 0x68,
	0xa2, 0xac, 0xad, 0x44, 0x36, 0x5b, 0xd6, 0xc2, 0xf2, 0xea, 0x0f, 0xc2, 0xfb, 0x77, 0xb6, 0xb8,
	0xa5, 0x99, 0xe6, 0xee, 0x05, 0xce, 0xc6, 0x4c, 0xb1, 0x21, 0x78, 0x7b, 0x15, 0x54, 0xcb, 0xd7,
	0x8b, 0xfe, 0xc6, 0x41, 0xfe, 0xbd, 0xc1, 0x8d, 0xf4, 0x74, 0x5e, 0x76, 0x82, 0x95, 0xd9, 0xad,
	0xe3, 0x0c, 0x24, 0x79, 0x2f, 0x65, 0x52, 0x47, 0x5b, 0x29, 0xd3, 0xbe, 0x0a, 0x59, 0xab, 0xfb,
	0x8a, 0x8b, 0x06, 0xb7, 0x41, 0x4b, 0xc5, 0xdb, 0x7c, 0x1c, 0x4b, 0xa5, 0xdb, 0x3d, 0xa6, 0x99,
	0x97, 0xae, 0xa4, 0x6a, 0xf9, 0xfa, 0xe9, 0x76, 0x4b, 0x22, 0x5a, 0x89, 0xbd, 0x69, 0xdc, 0xb7,
	0x4c, 0xb3, 0x66, 0xa4, 0xd5, 0xa4, 0xe1, 0x7d, 0xcf, 0xcb, 0x05, 0xd8, 0x81, 0x83, 0x9d, 0x7f,
	0x2f, 0xd3, 0x5f, 0xef, 0x65, 0xa7, 0x7a, 0x83, 0x8f, 0xff, 0xad, 0x74, 0x0f, 0x71, 0xaa, 0xcf,
	0x27, 0x1e, 0xaa, 0xa0, 0x5a, 0x2e, 0x48, 0xa4, 0x5b, 0xc0, 0x99, 0x67, 0x36, 0x18, 0x71, 0xf3,
	0x36, 0xb9, 0xc0, 0x7e, 0x34, 0x1e, 0xa6, 0x0b, 0x82, 0x66, 0x0b, 0x82, 0x3e, 0x17, 0x04, 0xbd,
	0x2d, 0x89, 0x33, 0x5b, 0x12, 0xe7, 0x63, 0x49, 0x9c, 0xc7, 0x2b, 0x11, 0xea, 0xa7, 0x51, 0xc7,
	0xef, 0xca, 0x21, 0xbd, 0xb6, 0x43, 0xd8, 0x1b, 0x9d, 0x41, 0xaf, 0x4f, 0x85, 0x1c, 0xb0, 0x48,
	0xd0, 0xae, 0x84, 0xa1, 0x04, 0x3a, 0xfe, 0xdb, 0x48, 0x4f, 0x62, 0x0e, 0x9d, 0xac, 0x59, 0xe8,
	0xfc, 0x37, 0x00, 0x00, 0xff, 0xff, 0x94, 0xe9, 0x22, 0x36, 0x09, 0x02, 0x00, 0x00,
}

func (m *GenesisState) Marshal() (dAtA []byte, err error) {
	size := m.Size()
	dAtA = make([]byte, size)
	n, err := m.MarshalToSizedBuffer(dAtA[:size])
	if err != nil {
		return nil, err
	}
	return dAtA[:n], nil
}

func (m *GenesisState) MarshalTo(dAtA []byte) (int, error) {
	size := m.Size()
	return m.MarshalToSizedBuffer(dAtA[:size])
}

func (m *GenesisState) MarshalToSizedBuffer(dAtA []byte) (int, error) {
	i := len(dAtA)
	_ = i
	var l int
	_ = l
	if len(m.SwingStoreExportData) > 0 {
		for iNdEx := len(m.SwingStoreExportData) - 1; iNdEx >= 0; iNdEx-- {
			{
				size, err := m.SwingStoreExportData[iNdEx].MarshalToSizedBuffer(dAtA[:i])
				if err != nil {
					return 0, err
				}
				i -= size
				i = encodeVarintGenesis(dAtA, i, uint64(size))
			}
			i--
			dAtA[i] = 0x22
		}
	}
	{
		size, err := m.State.MarshalToSizedBuffer(dAtA[:i])
		if err != nil {
			return 0, err
		}
		i -= size
		i = encodeVarintGenesis(dAtA, i, uint64(size))
	}
	i--
	dAtA[i] = 0x1a
	{
		size, err := m.Params.MarshalToSizedBuffer(dAtA[:i])
		if err != nil {
			return 0, err
		}
		i -= size
		i = encodeVarintGenesis(dAtA, i, uint64(size))
	}
	i--
	dAtA[i] = 0x12
	return len(dAtA) - i, nil
}

func (m *SwingStoreExportDataEntry) Marshal() (dAtA []byte, err error) {
	size := m.Size()
	dAtA = make([]byte, size)
	n, err := m.MarshalToSizedBuffer(dAtA[:size])
	if err != nil {
		return nil, err
	}
	return dAtA[:n], nil
}

func (m *SwingStoreExportDataEntry) MarshalTo(dAtA []byte) (int, error) {
	size := m.Size()
	return m.MarshalToSizedBuffer(dAtA[:size])
}

func (m *SwingStoreExportDataEntry) MarshalToSizedBuffer(dAtA []byte) (int, error) {
	i := len(dAtA)
	_ = i
	var l int
	_ = l
	if len(m.Value) > 0 {
		i -= len(m.Value)
		copy(dAtA[i:], m.Value)
		i = encodeVarintGenesis(dAtA, i, uint64(len(m.Value)))
		i--
		dAtA[i] = 0x12
	}
	if len(m.Key) > 0 {
		i -= len(m.Key)
		copy(dAtA[i:], m.Key)
		i = encodeVarintGenesis(dAtA, i, uint64(len(m.Key)))
		i--
		dAtA[i] = 0xa
	}
	return len(dAtA) - i, nil
}

func encodeVarintGenesis(dAtA []byte, offset int, v uint64) int {
	offset -= sovGenesis(v)
	base := offset
	for v >= 1<<7 {
		dAtA[offset] = uint8(v&0x7f | 0x80)
		v >>= 7
		offset++
	}
	dAtA[offset] = uint8(v)
	return base
}
func (m *GenesisState) Size() (n int) {
	if m == nil {
		return 0
	}
	var l int
	_ = l
	l = m.Params.Size()
	n += 1 + l + sovGenesis(uint64(l))
	l = m.State.Size()
	n += 1 + l + sovGenesis(uint64(l))
	if len(m.SwingStoreExportData) > 0 {
		for _, e := range m.SwingStoreExportData {
			l = e.Size()
			n += 1 + l + sovGenesis(uint64(l))
		}
	}
	return n
}

func (m *SwingStoreExportDataEntry) Size() (n int) {
	if m == nil {
		return 0
	}
	var l int
	_ = l
	l = len(m.Key)
	if l > 0 {
		n += 1 + l + sovGenesis(uint64(l))
	}
	l = len(m.Value)
	if l > 0 {
		n += 1 + l + sovGenesis(uint64(l))
	}
	return n
}

func sovGenesis(x uint64) (n int) {
	return (math_bits.Len64(x|1) + 6) / 7
}
func sozGenesis(x uint64) (n int) {
	return sovGenesis(uint64((x << 1) ^ uint64((int64(x) >> 63))))
}
func (m *GenesisState) Unmarshal(dAtA []byte) error {
	l := len(dAtA)
	iNdEx := 0
	for iNdEx < l {
		preIndex := iNdEx
		var wire uint64
		for shift := uint(0); ; shift += 7 {
			if shift >= 64 {
				return ErrIntOverflowGenesis
			}
			if iNdEx >= l {
				return io.ErrUnexpectedEOF
			}
			b := dAtA[iNdEx]
			iNdEx++
			wire |= uint64(b&0x7F) << shift
			if b < 0x80 {
				break
			}
		}
		fieldNum := int32(wire >> 3)
		wireType := int(wire & 0x7)
		if wireType == 4 {
			return fmt.Errorf("proto: GenesisState: wiretype end group for non-group")
		}
		if fieldNum <= 0 {
			return fmt.Errorf("proto: GenesisState: illegal tag %d (wire type %d)", fieldNum, wire)
		}
		switch fieldNum {
		case 2:
			if wireType != 2 {
				return fmt.Errorf("proto: wrong wireType = %d for field Params", wireType)
			}
			var msglen int
			for shift := uint(0); ; shift += 7 {
				if shift >= 64 {
					return ErrIntOverflowGenesis
				}
				if iNdEx >= l {
					return io.ErrUnexpectedEOF
				}
				b := dAtA[iNdEx]
				iNdEx++
				msglen |= int(b&0x7F) << shift
				if b < 0x80 {
					break
				}
			}
			if msglen < 0 {
				return ErrInvalidLengthGenesis
			}
			postIndex := iNdEx + msglen
			if postIndex < 0 {
				return ErrInvalidLengthGenesis
			}
			if postIndex > l {
				return io.ErrUnexpectedEOF
			}
			if err := m.Params.Unmarshal(dAtA[iNdEx:postIndex]); err != nil {
				return err
			}
			iNdEx = postIndex
		case 3:
			if wireType != 2 {
				return fmt.Errorf("proto: wrong wireType = %d for field State", wireType)
			}
			var msglen int
			for shift := uint(0); ; shift += 7 {
				if shift >= 64 {
					return ErrIntOverflowGenesis
				}
				if iNdEx >= l {
					return io.ErrUnexpectedEOF
				}
				b := dAtA[iNdEx]
				iNdEx++
				msglen |= int(b&0x7F) << shift
				if b < 0x80 {
					break
				}
			}
			if msglen < 0 {
				return ErrInvalidLengthGenesis
			}
			postIndex := iNdEx + msglen
			if postIndex < 0 {
				return ErrInvalidLengthGenesis
			}
			if postIndex > l {
				return io.ErrUnexpectedEOF
			}
			if err := m.State.Unmarshal(dAtA[iNdEx:postIndex]); err != nil {
				return err
			}
			iNdEx = postIndex
		case 4:
			if wireType != 2 {
				return fmt.Errorf("proto: wrong wireType = %d for field SwingStoreExportData", wireType)
			}
			var msglen int
			for shift := uint(0); ; shift += 7 {
				if shift >= 64 {
					return ErrIntOverflowGenesis
				}
				if iNdEx >= l {
					return io.ErrUnexpectedEOF
				}
				b := dAtA[iNdEx]
				iNdEx++
				msglen |= int(b&0x7F) << shift
				if b < 0x80 {
					break
				}
			}
			if msglen < 0 {
				return ErrInvalidLengthGenesis
			}
			postIndex := iNdEx + msglen
			if postIndex < 0 {
				return ErrInvalidLengthGenesis
			}
			if postIndex > l {
				return io.ErrUnexpectedEOF
			}
			m.SwingStoreExportData = append(m.SwingStoreExportData, &SwingStoreExportDataEntry{})
			if err := m.SwingStoreExportData[len(m.SwingStoreExportData)-1].Unmarshal(dAtA[iNdEx:postIndex]); err != nil {
				return err
			}
			iNdEx = postIndex
		default:
			iNdEx = preIndex
			skippy, err := skipGenesis(dAtA[iNdEx:])
			if err != nil {
				return err
			}
			if (skippy < 0) || (iNdEx+skippy) < 0 {
				return ErrInvalidLengthGenesis
			}
			if (iNdEx + skippy) > l {
				return io.ErrUnexpectedEOF
			}
			iNdEx += skippy
		}
	}

	if iNdEx > l {
		return io.ErrUnexpectedEOF
	}
	return nil
}
func (m *SwingStoreExportDataEntry) Unmarshal(dAtA []byte) error {
	l := len(dAtA)
	iNdEx := 0
	for iNdEx < l {
		preIndex := iNdEx
		var wire uint64
		for shift := uint(0); ; shift += 7 {
			if shift >= 64 {
				return ErrIntOverflowGenesis
			}
			if iNdEx >= l {
				return io.ErrUnexpectedEOF
			}
			b := dAtA[iNdEx]
			iNdEx++
			wire |= uint64(b&0x7F) << shift
			if b < 0x80 {
				break
			}
		}
		fieldNum := int32(wire >> 3)
		wireType := int(wire & 0x7)
		if wireType == 4 {
			return fmt.Errorf("proto: SwingStoreExportDataEntry: wiretype end group for non-group")
		}
		if fieldNum <= 0 {
			return fmt.Errorf("proto: SwingStoreExportDataEntry: illegal tag %d (wire type %d)", fieldNum, wire)
		}
		switch fieldNum {
		case 1:
			if wireType != 2 {
				return fmt.Errorf("proto: wrong wireType = %d for field Key", wireType)
			}
			var stringLen uint64
			for shift := uint(0); ; shift += 7 {
				if shift >= 64 {
					return ErrIntOverflowGenesis
				}
				if iNdEx >= l {
					return io.ErrUnexpectedEOF
				}
				b := dAtA[iNdEx]
				iNdEx++
				stringLen |= uint64(b&0x7F) << shift
				if b < 0x80 {
					break
				}
			}
			intStringLen := int(stringLen)
			if intStringLen < 0 {
				return ErrInvalidLengthGenesis
			}
			postIndex := iNdEx + intStringLen
			if postIndex < 0 {
				return ErrInvalidLengthGenesis
			}
			if postIndex > l {
				return io.ErrUnexpectedEOF
			}
			m.Key = string(dAtA[iNdEx:postIndex])
			iNdEx = postIndex
		case 2:
			if wireType != 2 {
				return fmt.Errorf("proto: wrong wireType = %d for field Value", wireType)
			}
			var stringLen uint64
			for shift := uint(0); ; shift += 7 {
				if shift >= 64 {
					return ErrIntOverflowGenesis
				}
				if iNdEx >= l {
					return io.ErrUnexpectedEOF
				}
				b := dAtA[iNdEx]
				iNdEx++
				stringLen |= uint64(b&0x7F) << shift
				if b < 0x80 {
					break
				}
			}
			intStringLen := int(stringLen)
			if intStringLen < 0 {
				return ErrInvalidLengthGenesis
			}
			postIndex := iNdEx + intStringLen
			if postIndex < 0 {
				return ErrInvalidLengthGenesis
			}
			if postIndex > l {
				return io.ErrUnexpectedEOF
			}
			m.Value = string(dAtA[iNdEx:postIndex])
			iNdEx = postIndex
		default:
			iNdEx = preIndex
			skippy, err := skipGenesis(dAtA[iNdEx:])
			if err != nil {
				return err
			}
			if (skippy < 0) || (iNdEx+skippy) < 0 {
				return ErrInvalidLengthGenesis
			}
			if (iNdEx + skippy) > l {
				return io.ErrUnexpectedEOF
			}
			iNdEx += skippy
		}
	}

	if iNdEx > l {
		return io.ErrUnexpectedEOF
	}
	return nil
}
func skipGenesis(dAtA []byte) (n int, err error) {
	l := len(dAtA)
	iNdEx := 0
	depth := 0
	for iNdEx < l {
		var wire uint64
		for shift := uint(0); ; shift += 7 {
			if shift >= 64 {
				return 0, ErrIntOverflowGenesis
			}
			if iNdEx >= l {
				return 0, io.ErrUnexpectedEOF
			}
			b := dAtA[iNdEx]
			iNdEx++
			wire |= (uint64(b) & 0x7F) << shift
			if b < 0x80 {
				break
			}
		}
		wireType := int(wire & 0x7)
		switch wireType {
		case 0:
			for shift := uint(0); ; shift += 7 {
				if shift >= 64 {
					return 0, ErrIntOverflowGenesis
				}
				if iNdEx >= l {
					return 0, io.ErrUnexpectedEOF
				}
				iNdEx++
				if dAtA[iNdEx-1] < 0x80 {
					break
				}
			}
		case 1:
			iNdEx += 8
		case 2:
			var length int
			for shift := uint(0); ; shift += 7 {
				if shift >= 64 {
					return 0, ErrIntOverflowGenesis
				}
				if iNdEx >= l {
					return 0, io.ErrUnexpectedEOF
				}
				b := dAtA[iNdEx]
				iNdEx++
				length |= (int(b) & 0x7F) << shift
				if b < 0x80 {
					break
				}
			}
			if length < 0 {
				return 0, ErrInvalidLengthGenesis
			}
			iNdEx += length
		case 3:
			depth++
		case 4:
			if depth == 0 {
				return 0, ErrUnexpectedEndOfGroupGenesis
			}
			depth--
		case 5:
			iNdEx += 4
		default:
			return 0, fmt.Errorf("proto: illegal wireType %d", wireType)
		}
		if iNdEx < 0 {
			return 0, ErrInvalidLengthGenesis
		}
		if depth == 0 {
			return iNdEx, nil
		}
	}
	return 0, io.ErrUnexpectedEOF
}

var (
	ErrInvalidLengthGenesis        = fmt.Errorf("proto: negative length found during unmarshaling")
	ErrIntOverflowGenesis          = fmt.Errorf("proto: integer overflow")
	ErrUnexpectedEndOfGroupGenesis = fmt.Errorf("proto: unexpected end of group")
)
